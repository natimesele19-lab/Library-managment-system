import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

const ENGLISH_MONTHS = [
  "Meskerem", "Tikimt", "Hidar", "Tahsas", "Tir", "Yekatit",
  "Megabit", "Miyazya", "Ginbot", "Sene", "Hamle", "Nehase", "Pagume",
];
const AMHARIC_MONTHS = [
  "መስከረም", "ጥቅምት", "ኅዳር", "ታኅሣሥ", "ጥር", "የካቲት",
  "መጋቢት", "ሚያዝያ", "ግንቦት", "ሰኔ", "ሐምሌ", "ነሐሴ", "ጳጉሜ",
];
const ENGLISH_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const AMHARIC_WEEKDAYS = ["እሑድ", "ሰኞ", "ማክሰኞ", "ረቡዕ", "ሐሙስ", "ዓርብ", "ቅዳሜ"];
const ETHIOPIAN_ANCHOR = Date.UTC(2026, 8, 11) / 86_400_000;
const ETHIOPIAN_ANCHOR_YEAR = 2019;

function daysBeforeEthiopianYear(year: number): number {
  return 365 * (year - ETHIOPIAN_ANCHOR_YEAR) + Math.floor(year / 4) - Math.floor(ETHIOPIAN_ANCHOR_YEAR / 4);
}

function daysInEthiopianMonth(year: number, month: number): number {
  return month === 13 ? (year % 4 === 3 ? 6 : 5) : 30;
}

function isValidEthiopianDate(year: number, month: number, day: number): boolean {
  return Number.isInteger(year) && year >= 1 && Number.isInteger(month) && month >= 1 && month <= 13 &&
    Number.isInteger(day) && day >= 1 && day <= daysInEthiopianMonth(year, month);
}

export function ethiopianDateToGregorian(value: string): string | null {
  const match = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!isValidEthiopianDate(year, month, day)) return null;
  const daysFromAnchor = daysBeforeEthiopianYear(year) + (month - 1) * 30 + day - 1;
  return new Date((ETHIOPIAN_ANCHOR + daysFromAnchor) * 86_400_000).toISOString().slice(0, 10);
}

export function gregorianDateToEthiopian(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const absoluteDays = Date.UTC(year, month - 1, day) / 86_400_000;
  const daysFromAnchor = absoluteDays - ETHIOPIAN_ANCHOR;
  let ethiopianYear = ETHIOPIAN_ANCHOR_YEAR + Math.floor(daysFromAnchor / 365.25);
  while (daysFromAnchor < daysBeforeEthiopianYear(ethiopianYear)) ethiopianYear -= 1;
  while (daysFromAnchor >= daysBeforeEthiopianYear(ethiopianYear + 1)) ethiopianYear += 1;
  let dayOfYear = daysFromAnchor - daysBeforeEthiopianYear(ethiopianYear);
  const ethiopianMonth = Math.floor(dayOfYear / 30) + 1;
  dayOfYear %= 30;
  return `${String(ethiopianYear).padStart(4, "0")}-${String(ethiopianMonth).padStart(2, "0")}-${String(dayOfYear + 1).padStart(2, "0")}`;
}

export function formatEthiopianDate(value: string, language: string): string {
  const ethiopianDate = gregorianDateToEthiopian(value);
  if (!ethiopianDate) return "—";
  const [, year, month, day] = /^(\d+)-(\d+)-(\d+)$/.exec(ethiopianDate)!;
  const months = language === "am" ? AMHARIC_MONTHS : ENGLISH_MONTHS;
  return `${months[Number(month) - 1]} ${Number(day)}, ${Number(year)}`;
}

export function todayEthiopianDate(): string {
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return gregorianDateToEthiopian(localDate) ?? "";
}

export function DatePickerInput({ label, name, value, onChange, language, required, placeholder }: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  language: string;
  required?: boolean;
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const currentDate = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const parsedYear = currentDate ? Number(currentDate[1]) : undefined;
  const parsedMonth = currentDate ? Number(currentDate[2]) : undefined;
  const [visibleYear, setVisibleYear] = useState(parsedYear ?? Number(todayEthiopianDate().slice(0, 4)));
  const [visibleMonth, setVisibleMonth] = useState(parsedMonth ?? Number(todayEthiopianDate().slice(5, 7)));
  const isAmharic = language === "am";
  const months = isAmharic ? AMHARIC_MONTHS : ENGLISH_MONTHS;
  const weekdays = isAmharic ? AMHARIC_WEEKDAYS : ENGLISH_WEEKDAYS;
  const firstDay = ethiopianDateToGregorian(`${visibleYear}-${visibleMonth}-01`);
  const firstWeekday = firstDay ? new Date(`${firstDay}T00:00:00Z`).getUTCDay() : 0;
  const monthLength = daysInEthiopianMonth(visibleYear, visibleMonth);
  const selectedDay = currentDate && Number(currentDate[1]) === visibleYear && Number(currentDate[2]) === visibleMonth
    ? Number(currentDate[3])
    : null;

  function moveMonth(delta: number) {
    const next = visibleMonth + delta;
    if (next < 1) {
      setVisibleMonth(13);
      setVisibleYear((year) => year - 1);
    } else if (next > 13) {
      setVisibleMonth(1);
      setVisibleYear((year) => year + 1);
    } else {
      setVisibleMonth(next);
    }
  }

  return <div className="field ethiopian-date-field">
    <label htmlFor={`field-${name}`}>{label}</label>
    <div className="ethiopian-date-control">
      <input
        id={`field-${name}`}
        name={name}
        type="text"
        inputMode="numeric"
        value={value}
        required={required}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className="ethiopian-date-trigger" aria-label={label} aria-expanded={isOpen} onClick={() => {
        if (!isOpen) {
          if (parsedYear && parsedMonth && parsedMonth <= 13) {
            setVisibleYear(parsedYear);
            setVisibleMonth(parsedMonth);
          } else {
            const today = todayEthiopianDate();
            setVisibleYear(Number(today.slice(0, 4)));
            setVisibleMonth(Number(today.slice(5, 7)));
          }
        }
        setIsOpen(!isOpen);
      }}><CalendarDays size={15} /></button>
    </div>
    {isOpen && <div className="ethiopian-date-picker" role="dialog" aria-label={label}>
      <div className="ethiopian-date-picker-head">
        <button type="button" className="row-action" aria-label={isAmharic ? "ያለፈው ወር" : "Previous month"} onClick={() => moveMonth(-1)}><ChevronLeft size={15} /></button>
        <select aria-label={isAmharic ? "ወር" : "Month"} value={visibleMonth} onChange={(event) => setVisibleMonth(Number(event.target.value))}>
          {months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
        </select>
        <input aria-label={isAmharic ? "ዓመት" : "Year"} type="number" min={1} value={visibleYear} onChange={(event) => setVisibleYear(Math.max(1, Number(event.target.value) || 1))} />
        <button type="button" className="row-action" aria-label={isAmharic ? "ቀጣይ ወር" : "Next month"} onClick={() => moveMonth(1)}><ChevronRight size={15} /></button>
        <button type="button" className="row-action" aria-label={isAmharic ? "ዝጋ" : "Close"} onClick={() => setIsOpen(false)}><X size={14} /></button>
      </div>
      <div className="ethiopian-date-grid">
        {weekdays.map((weekday) => <span className="ethiopian-date-weekday" key={weekday}>{weekday}</span>)}
        {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: monthLength }, (_, index) => {
          const day = index + 1;
          return <button
            type="button"
            key={day}
            className={day === selectedDay ? "selected" : ""}
            aria-pressed={day === selectedDay}
            onClick={() => {
              onChange(`${String(visibleYear).padStart(4, "0")}-${String(visibleMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
              setIsOpen(false);
            }}
          >{day}</button>;
        })}
      </div>
    </div>}
  </div>;
}
