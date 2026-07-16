// src/services/backup/infrastructure/GoogleSheetsAdapter.ts
import crypto from "crypto";
import { SpreadsheetClient } from "../domain/ports";

export class GoogleSheetsAdapter implements SpreadsheetClient {
  /**
   * Helper to parse Spreadsheet ID from URL
   */
  private extractSpreadsheetId(url: string): string {
    if (!url) throw new Error("Google Sheet URL is empty.");
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
      throw new Error("Invalid Google Sheet URL. Could not extract spreadsheet ID.");
    }
    return match[1];
  }

  /**
   * Generates a signed OAuth JWT for the Google Service Account
   */
  private signJwt(payload: any, privateKey: string): string {
    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const base64UrlEncode = (str: string) => {
      return Buffer.from(str)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    };

    const headerB64 = base64UrlEncode(JSON.stringify(header));
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;

    const sign = crypto.createSign("RSA-SHA256");
    sign.update(signingInput);

    // Format private key correctly (replace literal \n with real newlines)
    const formattedPrivateKey = privateKey.replace(/\\n/g, "\n");
    const signature = sign.sign(formattedPrivateKey, "base64");
    const signatureB64 = signature
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    return `${signingInput}.${signatureB64}`;
  }

  /**
   * Authenticate and retrieve OAuth Access Token
   */
  public async authenticate(serviceAccountJson: string): Promise<string> {
    try {
      const credentials = JSON.parse(serviceAccountJson);
      const { client_email, private_key, token_uri } = credentials;

      if (!client_email || !private_key) {
        throw new Error("Invalid Service Account JSON. Missing client_email or private_key.");
      }

      const tokenUrl = token_uri || "https://oauth2.googleapis.com/token";
      const iat = Math.floor(Date.now() / 1000);
      const exp = iat + 3600; // 1 hour expiration

      const payload = {
        iss: client_email,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        aud: tokenUrl,
        exp,
        iat,
      };

      const assertion = this.signJwt(payload, private_key);

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Google OAuth API token request failed: ${response.statusText} - ${errText}`);
      }

      const data = (await response.json()) as any;
      return data.access_token;
    } catch (err: any) {
      console.error("Google Sheets Authentication error:", err);
      throw new Error(`Authentication failed: ${err.message}`);
    }
  }

  /**
   * Verifies that the spreadsheet is accessible using the credentials
   */
  public async verifyConnection(spreadsheetUrl: string, serviceAccountJson: string): Promise<boolean> {
    try {
      const spreadsheetId = this.extractSpreadsheetId(spreadsheetUrl);
      const token = await this.authenticate(serviceAccountJson);

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.ok;
    } catch (err) {
      console.error("Connection check failed:", err);
      return false;
    }
  }

  /**
   * Syncs and appends tables to separate Google Sheets tabs
   */
  public async backupTables(
    spreadsheetUrl: string,
    serviceAccountJson: string,
    tables: Record<string, { headers: string[]; rows: any[][] }>
  ): Promise<{ success: boolean; details: Record<string, number>; error?: string }> {
    const details: Record<string, number> = {};
    try {
      const spreadsheetId = this.extractSpreadsheetId(spreadsheetUrl);
      const token = await this.authenticate(serviceAccountJson);

      // 1. Get existing sheets
      const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`;
      const metaRes = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!metaRes.ok) {
        const text = await metaRes.text();
        throw new Error(`Failed to load sheet metadata: ${metaRes.statusText} - ${text}`);
      }

      const metaData = (await metaRes.json()) as any;
      const existingSheets: string[] = (metaData.sheets || []).map(
        (s: any) => s.properties.title
      );

      // 2. Add missing sheets
      const sheetsToAdd = Object.keys(tables).filter(
        (name) => !existingSheets.includes(name)
      );

      if (sheetsToAdd.length > 0) {
        const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
        const body = {
          requests: sheetsToAdd.map((title) => ({
            addSheet: { properties: { title } },
          })),
        };

        const addRes = await fetch(updateUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!addRes.ok) {
          const text = await addRes.text();
          throw new Error(`Failed to create sheet tabs: ${addRes.statusText} - ${text}`);
        }
      }

      // 3. Populate data for each tab
      for (const [tabName, tableData] of Object.entries(tables)) {
        const { headers, rows } = tableData;
        if (rows.length === 0) {
          details[tabName] = 0;
          continue;
        }

        // Check if the tab is empty to decide if we should write headers
        const checkUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          tabName
        )}!A1:A1`;
        const checkRes = await fetch(checkUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });

        let isEmpty = true;
        if (checkRes.ok) {
          const checkData = (await checkRes.json()) as any;
          if (checkData.values && checkData.values.length > 0) {
            isEmpty = false;
          }
        }

        const valuesToAppend: any[][] = [];
        if (isEmpty) {
          valuesToAppend.push(headers);
        }
        valuesToAppend.push(...rows);

        const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          tabName
        )}:append?valueInputOption=USER_ENTERED`;

        const appendRes = await fetch(appendUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ values: valuesToAppend }),
        });

        if (!appendRes.ok) {
          const text = await appendRes.text();
          throw new Error(`Failed to append data to tab "${tabName}": ${appendRes.statusText} - ${text}`);
        }

        details[tabName] = rows.length;
      }

      return { success: true, details };
    } catch (err: any) {
      console.error("Backup execution failed:", err);
      return {
        success: false,
        details,
        error: err.message || "Unknown Google Sheets API error",
      };
    }
  }
}
