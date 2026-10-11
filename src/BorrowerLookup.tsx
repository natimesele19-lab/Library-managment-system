import { useEffect, useMemo, useState } from "react";
import { Camera, Search, X } from "lucide-react";
import { CameraScanner } from "./CameraScanner";

type Patron = {
  id: string;
  name: string;
  memberCode: string;
  email?: string;
  active?: boolean;
  type: "STUDENT" | "TEACHER";
};

export function BorrowerLookup<T extends Patron>({ patrons, selected, onSelect, onUnknownCode, t }: {
  patrons: T[];
  selected: T | null;
  onSelect: (patron: T | null) => void;
  onUnknownCode: () => void;
  t: (key: string) => string;
}) {
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  useEffect(() => {
    setQuery(selected ? `${selected.name} · ${selected.memberCode}` : "");
  }, [selected]);

  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized || selected) return [];
    return patrons.filter((patron) =>
      patron.active !== false &&
      `${patron.name} ${patron.memberCode} ${patron.email || ""}`.toLocaleLowerCase().includes(normalized),
    ).slice(0, 8);
  }, [patrons, query, selected]);

  function handleScan(code: string) {
    setScanning(false);
    const normalizedCode = code.trim();
    const match = patrons.find((patron) =>
      patron.active !== false && (patron.memberCode === normalizedCode || patron.id === normalizedCode),
    );
    if (match) {
      onSelect(match);
      setShowOptions(false);
    } else {
      onUnknownCode();
    }
  }

  return <div className="borrower-lookup">
    <label className="field">
      <span>{t("identifyBorrower")}</span>
      <div className="borrower-search">
        <Search size={15} aria-hidden="true" />
        <input
          aria-label={t("identifyBorrower")}
          autoComplete="off"
          placeholder={t("borrowerSearchPlaceholder")}
          value={query}
          onFocus={() => setShowOptions(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            if (selected) onSelect(null);
            setShowOptions(true);
          }}
        />
        {selected && <button className="row-action" type="button" aria-label={t("clearSelection")} onClick={() => { onSelect(null); setQuery(""); }}><X size={14} /></button>}
        <button className="button borrower-scan-button" type="button" onClick={() => setScanning(true)}><Camera size={13} />{t("scanBorrower")}</button>
      </div>
    </label>
    {showOptions && matches.length > 0 && <div className="borrower-options" role="listbox" aria-label={t("borrower")}>
      {matches.map((patron) => <button key={patron.id} type="button" role="option" className="borrower-option" onClick={() => { onSelect(patron); setShowOptions(false); }}>
        <span>{patron.name}</span><small>{patron.memberCode} · {t(patron.type === "TEACHER" ? "teacherRole" : "studentRole")}</small>
      </button>)}
    </div>}
    {showOptions && query.trim() && !matches.length && !selected && <div className="borrower-options borrower-no-results">{t("noBorrowersFound")}</div>}
    {scanning && <CameraScanner onClose={() => setScanning(false)} onScan={handleScan} />}
  </div>;
}
