// src/hooks/useDevicePermission.ts
import { useState, useEffect, useCallback } from "react";
import { 
  devicePermissionService, 
  PermissionType, 
  PermissionStatus, 
  PERMISSION_METADATA,
  PermissionDetails
} from "../services/devicePermissionService";

export function useDevicePermission() {
  const [statuses, setStatuses] = useState<Record<PermissionType, PermissionStatus>>({
    camera: "prompt",
    photos: "prompt",
    storage: "prompt",
    microphone: "prompt",
    location: "prompt",
    notifications: "prompt",
    bluetooth: "prompt",
    contacts: "prompt",
    calendar: "prompt",
    phone: "prompt"
  });
  const [loading, setLoading] = useState(true);

  // Check all permissions status
  const checkAll = useCallback(async () => {
    setLoading(true);
    const types: PermissionType[] = [
      "camera",
      "photos",
      "storage",
      "microphone",
      "location",
      "notifications",
      "bluetooth",
      "contacts",
      "calendar",
      "phone"
    ];
    
    const nextStatuses: Partial<Record<PermissionType, PermissionStatus>> = {};
    
    await Promise.all(
      types.map(async (type) => {
        const status = await devicePermissionService.checkStatus(type);
        nextStatuses[type] = status;
      })
    );

    setStatuses(nextStatuses as Record<PermissionType, PermissionStatus>);
    setLoading(false);
  }, []);

  // Request a specific permission
  const request = useCallback(async (type: PermissionType): Promise<PermissionStatus> => {
    const status = await devicePermissionService.request(type);
    setStatuses((prev) => ({
      ...prev,
      [type]: status
    }));
    return status;
  }, []);

  // Open Device settings
  const openSettings = useCallback(() => {
    devicePermissionService.openAppSettings();
  }, []);

  // Set up window focus listener to re-evaluate permissions when user returns from settings
  useEffect(() => {
    checkAll();

    if (typeof window !== "undefined") {
      const handleFocus = () => {
        console.log("Window gained focus. Refreshing device permissions...");
        checkAll();
      };
      
      window.addEventListener("focus", handleFocus);
      return () => {
        window.removeEventListener("focus", handleFocus);
      };
    }
  }, [checkAll]);

  return {
    statuses,
    loading,
    request,
    checkAll,
    openSettings,
    isCapacitor: devicePermissionService.isCapacitor(),
    metadata: PERMISSION_METADATA
  };
}
