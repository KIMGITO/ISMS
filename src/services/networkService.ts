type NetworkListener = (isOnline: boolean) => void;

class NetworkService {
  private onlineStatus = typeof navigator !== "undefined" ? navigator.onLine : true;
  private listeners: Set<NetworkListener> = new Set();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.verifyConnection());
      window.addEventListener("offline", () => this.setOnline(false));
      
      // Periodic ping just in case navigator.onLine is stuck (common on Linux WebKitGTK).
      // While offline it checks every 5 s, so the app notices quickly when the connection returns.
      let lastCheck = 0;
      setInterval(() => {
        const due = this.onlineStatus ? 30000 : 5000;
        if (Date.now() - lastCheck >= due) {
          lastCheck = Date.now();
          this.verifyConnection();
        }
      }, 5000);
      // A failed request to the server is a strong hint the connection dropped.
      window.addEventListener("network-action-failed", () => this.verifyConnection());
      // Initial check
      setTimeout(() => this.verifyConnection(), 1000);
    }
  }

  private async verifyConnection() {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.setOnline(false);
      return;
    }
    try {
      // Ping a reliable endpoint
      await fetch("https://1.1.1.1", { mode: 'no-cors', cache: 'no-store' });
      this.setOnline(true);
    } catch {
      this.setOnline(false);
    }
  }

  /**
   * Directly queries the live truth status of the current network socket state
   */
  public isOnline(): boolean {
    return this.onlineStatus;
  }

  /**
   * Explicit simulator trigger toggle intended purely for sandbox/debug environment overrides
   */
  public toggleNetwork(): boolean {
    this.setOnline(!this.onlineStatus);
    return this.onlineStatus;
  }

  private setOnline(status: boolean) {
    if (this.onlineStatus !== status) {
      this.onlineStatus = status;
      
      this.listeners.forEach((listener) => {
        try {
          listener(status);
        } catch (e) {
          console.error("Error in network status listener:", e);
        }
      });
    }
  }

  /**
   * Connects state stores to the window channel socket to immediately handle connection changes
   */
  public subscribe(listener: NetworkListener): () => void {
    this.listeners.add(listener);
    listener(this.onlineStatus); 
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const networkService = new NetworkService();