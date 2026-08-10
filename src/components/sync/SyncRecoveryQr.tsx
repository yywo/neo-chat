"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { renderSyncRecoveryQrDataUrl } from "@/lib/sync/recoveryQr";

export interface SyncRecoveryQrProps {
  payload: string;
  alt: string;
  loadingLabel: string;
  errorLabel: string;
  renderQr?: (payload: string) => Promise<string>;
}

export default function SyncRecoveryQr({
  payload,
  alt,
  loadingLabel,
  errorLabel,
  renderQr = renderSyncRecoveryQrDataUrl,
}: SyncRecoveryQrProps) {
  const [dataUrl, setDataUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setDataUrl(undefined);
    setFailed(false);
    void renderQr(payload)
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [payload, renderQr]);

  return (
    <div className="flex min-h-52 w-full items-center justify-center rounded-lg border border-amber-300 bg-white p-3 md:w-52 dark:border-amber-400/30">
      {dataUrl ? (
        <Image
          src={dataUrl}
          alt={alt}
          width={192}
          height={192}
          className="h-48 w-48"
          unoptimized
        />
      ) : failed ? (
        <p role="alert" className="max-w-40 text-center text-xs text-red-700">
          {errorLabel}
        </p>
      ) : (
        <p
          role="status"
          className="max-w-40 text-center text-xs text-slate-600"
        >
          {loadingLabel}
        </p>
      )}
    </div>
  );
}
