// src/core/native/SecureStorageService.ts
class SecureStorageService {
  private encryptionKey = "kkm-milk-secure-key-2026";

  /**
   * Encrypt and save a string value securely in local storage
   */
  public async setItem(key: string, value: string): Promise<void> {
    try {
      const encrypted = this.xorEncryptDecrypt(value, this.encryptionKey);
      const base64 = window.btoa(encrypted);
      localStorage.setItem(`kkm_sec_${key}`, base64);
    } catch (e) {
      console.error(`Error saving secure key ${key}:`, e);
      localStorage.setItem(`kkm_sec_${key}`, value); // Fallback to plain
    }
  }

  /**
   * Retrieve and decrypt a string value securely from local storage
   */
  public async getItem(key: string): Promise<string | null> {
    try {
      const base64 = localStorage.getItem(`kkm_sec_${key}`);
      if (!base64) return null;
      const decrypted = window.atob(base64);
      return this.xorEncryptDecrypt(decrypted, this.encryptionKey);
    } catch (e) {
      console.error(`Error reading secure key ${key}:`, e);
      return localStorage.getItem(`kkm_sec_${key}`); // Return plain fallback
    }
  }

  /**
   * Remove a secure item from local storage
   */
  public async removeItem(key: string): Promise<void> {
    localStorage.removeItem(`kkm_sec_${key}`);
  }

  /**
   * Simple XOR Cipher for lightweight client-side obfuscation / local storage encryption
   */
  private xorEncryptDecrypt(input: string, key: string): string {
    let output = "";
    for (let i = 0; i < input.length; i++) {
      const charCode = input.charCodeAt(i) ^ key.charCodeAt(i % key.length);
      output += String.fromCharCode(charCode);
    }
    return output;
  }
}

export const secureStorageService = new SecureStorageService();
export default secureStorageService;
