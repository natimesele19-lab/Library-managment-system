import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Camera, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function CameraScanner({ onClose, onScan }: { onClose: () => void; onScan: (code: string) => void }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);
  onScanRef.current = onScan;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const reader = new BrowserMultiFormatReader();
    let stopped = false;
    let controls: { stop: () => void } | undefined;

    void reader.decodeFromConstraints(
      { audio: false, video: { facingMode: { ideal: "environment" } } },
      video,
      (result) => {
        if (!result || stopped) return;
        stopped = true;
        controls?.stop();
        onScanRef.current(result.getText());
      },
    ).then((cameraControls) => {
      controls = cameraControls;
      if (stopped) cameraControls.stop();
      else setStarting(false);
    }).catch((cause: unknown) => {
      if (!stopped) setError(cause instanceof Error ? cause.message : t("cameraUnavailable"));
      setStarting(false);
    });

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [t]);

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
      <div className="modal-head">
        <div className="modal-title" id="scanner-title"><Camera size={18} style={{ verticalAlign: "middle", marginRight: 8 }} />{t("cameraScanner")}</div>
        <button className="row-action" aria-label={t("cancel")} onClick={onClose}><X size={17} /></button>
      </div>
      <video ref={videoRef} className="scanner-video" autoPlay muted playsInline />
      {starting && !error && <div className="loading-state">{t("startingCamera")}</div>}
      {error && <div className="notice" role="alert">{t("cameraPermissionHelp")} {error}</div>}
      <p className="scanner-help">{t("scannerHelp")}</p>
      <div className="modal-actions"><button className="button" onClick={onClose}>{t("cancel")}</button></div>
    </div>
  </div>;
}
