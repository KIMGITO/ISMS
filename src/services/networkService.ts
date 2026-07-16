type NetworkListener = (isOnline: boolean) => void;

class NetworkService {
  private onlineStatus = typeof navigator !== "undefined" ? navigator.onLine : true;
  private listeners: Set<NetworkListener> = new Set();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.setOnline(true));
      window.addEventListener("offline", () => this.setOnline(false));
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