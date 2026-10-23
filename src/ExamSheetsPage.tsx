import { useState } from "react";
import { ExternalLink, FileText, LayoutGrid, List, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { ApiRecord } from "./api";

type ExamSheetRow = ApiRecord & { [key: string]: unknown };

export function ExamSheetsPage({ records, loading, query, setQuery, busy, libraryName, t, onCreate, onEdit, onDelete, onOpenFile }: {
  records: ExamSheetRow[];
  loading: boolean;
  query: string;
  setQuery: (query: string) => void;
  busy: boolean;
  libraryName: string;
  t: (key: string) => string;
  onCreate: () => void;
  onEdit: (record: ExamSheetRow) => void;
  onDelete: (record: ExamSheetRow) => void;
  onOpenFile: (record: ExamSheetRow) => void;
}) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const text = (value: unknown) => value == null || value === "" ? "—" : String(value);
  const secureFileUrl = (value: unknown) => {
    if (typeof value !== "string") return "";
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  };

  return <>
    <div className="page-heading">
      <div>
        <div className="eyebrow">{libraryName} · {t("examSheets")}</div>
        <h1 className="page-title">{t("examSheets")}</h1>
        <p className="page-description">{t("examSheetsDescription")}</p>
      </div>
      <button className="button button-primary" onClick={onCreate}><Plus size={13} />{t("addExamSheet")}</button>
    </div>
    <section className="panel">
      <div className="toolbar">
        <label className="table-search" style={{ flex: 1 }}>
          <Search size={14} />
          <input aria-label={t("searchExamSheets")} placeholder={t("searchExamSheets")} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="view-mode-toggle" role="group" aria-label={t("viewMode")}>
          <button type="button" className={`button ${viewMode === "grid" ? "active" : ""}`} aria-pressed={viewMode === "grid"} title={t("gridView")} onClick={() => setViewMode("grid")}><LayoutGrid size={14} /><span>{t("gridView")}</span></button>
          <button type="button" className={`button ${viewMode === "list" ? "active" : ""}`} aria-pressed={viewMode === "list"} title={t("listView")} onClick={() => setViewMode("list")}><List size={14} /><span>{t("listView")}</span></button>
        </div>
      </div>
      {viewMode === "grid" && <div className="exam-sheet-grid">
        {loading ? <div className="loading-state">{t("loading")}</div> : records.length ? records.map((record) => <article className="panel exam-sheet-card" key={record.id}>
          <div className="record-card-heading"><div className="record-card-icon"><FileText size={18} /></div><div><h2>{text(record.title)}</h2><small>{text(record.subject)}</small></div></div>
          <div className="record-card-details">
            <div className="record-card-detail"><span>{t("grade")}</span><strong>{text(record.grade)}</strong></div>
            <div className="record-card-detail"><span>{t("examYear")}</span><strong>{text(record.examYear)}</strong></div>
            <div className="record-card-detail"><span>{t("available")}</span><strong>{text(record.availableCopies)} / {text(record.copies)}</strong></div>
          </div>
          <div className="record-card-actions">
            {secureFileUrl(record.filePath) && <button className="row-action" title={t("openFile")} aria-label={t("openFile")} onClick={() => onOpenFile({ ...record, mediaType: "PDF" })}><ExternalLink size={14} /></button>}
            <button className="row-action" title={t("edit")} aria-label={`${t("edit")}: ${text(record.title)}`} disabled={busy} onClick={() => onEdit(record)}><Pencil size={14} /></button>
            <button className="row-action" title={t("delete")} aria-label={`${t("delete")}: ${text(record.title)}`} disabled={busy} onClick={() => onDelete(record)}><Trash2 size={14} /></button>
          </div>
        </article>) : <div className="empty-state">{query ? t("noExamSheets") : t("noRecords")}</div>}
      </div>}
      <div className="table-wrap" hidden={viewMode === "grid"}><table className="data-table">
        <thead><tr><th>{t("title")}</th><th>{t("subject")}</th><th>{t("grade")}</th><th>{t("examYear")}</th><th>{t("available")}</th><th>{t("actions")}</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={6}><div className="loading-state">{t("loading")}</div></td></tr> : records.length ? records.map((record) => <tr key={record.id}>
            <td><strong>{text(record.title)}</strong></td>
            <td>{text(record.subject)}</td>
            <td>{text(record.grade)}</td>
            <td>{text(record.examYear)}</td>
            <td>{text(record.availableCopies)} / {text(record.copies)}</td>
            <td><div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              {secureFileUrl(record.filePath) && <button className="row-action" title={t("openFile")} aria-label={t("openFile")} onClick={() => onOpenFile({ ...record, mediaType: "PDF" })}><ExternalLink size={14} /></button>}
              <button className="row-action" title={t("edit")} aria-label={`${t("edit")}: ${text(record.title)}`} disabled={busy} onClick={() => onEdit(record)}><Pencil size={14} /></button>
              <button className="row-action" title={t("delete")} aria-label={`${t("delete")}: ${text(record.title)}`} disabled={busy} onClick={() => onDelete(record)}><Trash2 size={14} /></button>
            </div></td>
          </tr>) : <tr><td colSpan={6}><div className="empty-state">{query ? t("noExamSheets") : t("noRecords")}</div></td></tr>}
        </tbody>
      </table></div>
      <div className="table-footer"><span>{records.length} {t("examSheets").toLowerCase()}</span><span>{libraryName}</span></div>
    </section>
  </>;
}