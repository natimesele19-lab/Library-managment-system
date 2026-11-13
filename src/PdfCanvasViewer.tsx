import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export function PdfCanvasViewer({ url, t }: {
  url: string;
  t: (key: string) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadingTask = getDocument(url);
    setDocumentProxy(null);
    setPageNumber(1);
    setLoading(true);
    setError("");

    void loadingTask.promise.then((loadedDocument) => {
      if (!active) {
        void loadedDocument.destroy();
        return;
      }
      setDocumentProxy(loadedDocument);
      setLoading(false);
    }).catch((cause: unknown) => {
      if (active) {
        setError(cause instanceof Error ? cause.message : t("pdfLoadError"));
        setLoading(false);
      }
    });

    return () => {
      active = false;
      void loadingTask.destroy();
    };
  }, [url, t]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateWidth = () => setContainerWidth(container.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!documentProxy || !canvas || !containerWidth) return;
    let active = true;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;
    setError("");

    void documentProxy.getPage(pageNumber).then((page) => {
      if (!active) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const fitScale = Math.min((containerWidth - 24) / baseViewport.width, 2);
      const viewport = page.getViewport({ scale: Math.max(0.1, fitScale * zoom) });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("pdfRenderError"));

      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      return renderTask.promise;
    }).catch((cause: unknown) => {
      if (active && !(cause instanceof Error && cause.name === "RenderingCancelledException")) {
        setError(cause instanceof Error ? cause.message : t("pdfRenderError"));
      }
    });

    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [containerWidth, documentProxy, pageNumber, t, zoom]);

  const pageCount = documentProxy?.numPages ?? 0;
  return <section className="pdf-canvas-viewer" aria-label={t("pdfViewer")}>
    <div className="pdf-viewer-toolbar">
      <div className="pdf-page-controls">
        <button type="button" className="row-action" aria-label={t("previousPage")} disabled={!documentProxy || pageNumber <= 1}
          onClick={() => setPageNumber((current) => Math.max(1, current - 1))}><ChevronLeft size={17} /></button>
        <span aria-live="polite">{t("pageLabel")} {pageNumber} {t("of")} {pageCount || "—"}</span>
        <button type="button" className="row-action" aria-label={t("nextPage")} disabled={!documentProxy || pageNumber >= pageCount}
          onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}><ChevronRight size={17} /></button>
      </div>
      <div className="pdf-zoom-controls">
        <button type="button" className="row-action" aria-label={t("zoomOut")} disabled={zoom <= 0.6}
          onClick={() => setZoom((current) => Math.max(0.6, Math.round((current - 0.2) * 10) / 10))}><Minus size={15} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" className="row-action" aria-label={t("zoomIn")} disabled={zoom >= 2}
          onClick={() => setZoom((current) => Math.min(2, Math.round((current + 0.2) * 10) / 10))}><Plus size={15} /></button>
      </div>
    </div>
    {loading && <div className="pdf-viewer-status" role="status">{t("loading")}</div>}
    {error && <div className="notice" role="alert">{error}</div>}
    <div className="pdf-canvas-scroll" ref={containerRef}>
      <canvas ref={canvasRef} aria-label={`${t("pageLabel")} ${pageNumber}`} />
    </div>
  </section>;
}
