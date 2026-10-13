import { QRCodeSVG } from "qrcode.react";

export type IDCardPatron = {
  name: string;
  memberCode: string;
  type: "STUDENT" | "TEACHER";
  gender?: string;
  email?: string;
  phone?: string;
  grade?: string | null;
  department?: string | null;
};

export function IDCard({ patron, libraryName, t }: { patron: IDCardPatron; libraryName: string; t: (key: string) => string }) {
  const detail = patron.type === "TEACHER" ? patron.department : patron.grade;
  const detailLabel = patron.type === "TEACHER" ? t("department") : t("grade");

  return <article className={`id-card ${patron.type === "TEACHER" ? "id-card-teacher" : ""}`}>
    <div className="id-card-content">
      <div className="id-card-details">
        <div className="id-card-brand">
          <span className="id-card-library-name">{libraryName}</span>
          <span className="id-card-brand-role">
            <span aria-hidden="true">— </span>
            {t(patron.type === "TEACHER" ? "teacherRole" : "studentRole")}
          </span>
        </div>
        <h2>{patron.name}</h2>
        <dl>
          <div><dt>{t("id")}</dt><dd>{patron.memberCode}</dd></div>
          <div><dt>{t("role")}</dt><dd>{t(patron.type === "TEACHER" ? "teacherRole" : "studentRole")}</dd></div>
          {patron.gender && <div><dt>{t("gender")}</dt><dd>{t(patron.gender.toLowerCase())}</dd></div>}
          {detail && <div><dt>{detailLabel}</dt><dd>{detail}</dd></div>}
          {patron.email && <div><dt>{t("email")}</dt><dd>{patron.email}</dd></div>}
          {patron.phone && <div><dt>{t("phone")}</dt><dd>{patron.phone}</dd></div>}
        </dl>
      </div>
      <div className="id-card-qr" aria-label={t("memberQrCode")}>
        <QRCodeSVG value={patron.memberCode} size={112} level="M" />
      </div>
    </div>
  </article>;
}
