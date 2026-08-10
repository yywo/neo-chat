"use client";

import { useEffect } from "react";
import { startEncryptedSyncScheduler } from "@/lib/sync/scheduler";

export default function SyncLifecycle() {
  useEffect(() => startEncryptedSyncScheduler(), []);

  return null;
}
