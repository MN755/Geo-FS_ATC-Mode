import { useEffect, useState } from "react";
import {
  createReferenceVersionKey,
  getReferenceTextCacheEntry,
  saveReferenceTextCacheEntry
} from "../../shared/persistence/referenceCache";
import type { ReferenceDocument } from "../../domain/references/types";

export interface PdfPageText {
  pageNumber: number;
  text: string;
}

export interface PdfDocumentProxyLite {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getViewport: (params: { scale: number }) => { width: number; height: number };
    getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
    render: (params: {
      canvas: HTMLCanvasElement;
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
    }) => { promise: Promise<unknown> };
  }>;
}

export const usePdfDocument = (document: ReferenceDocument | null) => {
  const [documentProxy, setDocumentProxy] = useState<PdfDocumentProxyLite | null>(null);
  const [pageTexts, setPageTexts] = useState<PdfPageText[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!document || document.type !== "pdf") {
        setDocumentProxy(null);
        setPageTexts([]);
        setFromCache(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const cached = await getReferenceTextCacheEntry(document);
        if (!cancelled && cached) {
          setPageTexts(cached.pageTexts);
          setFromCache(true);
        }

        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

        const loadingTask = pdfjs.getDocument({ url: document.sourcePath });
        const pdf = await loadingTask.promise;
        if (cancelled) {
          return;
        }

        setDocumentProxy(pdf as unknown as PdfDocumentProxyLite);

        if (!cached) {
          const nextPageTexts: PdfPageText[] = [];
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const textContent = await page.getTextContent();
            const text = textContent.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            nextPageTexts.push({ pageNumber, text });
          }

          if (!cancelled) {
            setPageTexts(nextPageTexts);
            setFromCache(false);
          }

          await saveReferenceTextCacheEntry({
            documentId: document.id,
            versionKey: createReferenceVersionKey(document),
            extractedAt: Date.now(),
            ok: true,
            pageTexts: nextPageTexts
          });
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Unable to load PDF.";
        if (!cancelled) {
          setError(message);
          setDocumentProxy(null);
        }

        await saveReferenceTextCacheEntry({
          documentId: document.id,
          versionKey: createReferenceVersionKey(document),
          extractedAt: Date.now(),
          ok: false,
          pageTexts: [],
          error: message
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [document]);

  return {
    documentProxy,
    pageTexts,
    loading,
    error,
    fromCache
  };
};
