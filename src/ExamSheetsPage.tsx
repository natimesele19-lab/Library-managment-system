import { ExternalLink, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { ApiRecord } from "./api";

type ExamSheetRow = ApiRecord & { [key: string]: unknown };

export function ExamSheetsPage({ records, loading, query, setQuery, busy, libraryName, t, onCreate, onEdit, onDelete }: {
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
}) {
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
      </div>
      <div className="table-wrap"><table className="data-table">
        <thead><tr><th>{t("title")}</th><th>{t("subject")}</th><th>{t("grade")}</th><th>{t("examYear")}</th><th>{t("available")}</th><th>{t("actions")}</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={6}><div className="loading-state">{t("loading")}</div></td></tr> : records.length ? records.map((record) => <tr key={record.id}>
            <td><strong>{text(record.title)}</strong></td>
            <td>{text(record.subject)}</td>
            <td>{text(record.grade)}</td>
            <td>{text(record.examYear)}</td>
            <td>{text(record.availableCopies)} / {text(record.copies)}</td>
            <td><div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              {secureFileUrl(record.filePath) && <a className="row-action" href={secureFileUrl(record.filePath)} target="_blank" rel="noopener noreferrer" title={t("openFile")} aria-label={t("openFile")}><ExternalLink size={14} /></a>}
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