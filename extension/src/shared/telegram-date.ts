const telegramMonthIndexes: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

export type TelegramCalendarDate = { year: number; monthIndex: number; day: number };

export function parseTelegramDateLabel(value: string, currentYear = new Date().getFullYear()): TelegramCalendarDate | undefined {
  const normalized = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{4}))?$/i);
  if (!match) return undefined;
  const monthIndex = telegramMonthIndexes[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : currentYear;
  const candidate = new Date(year, monthIndex, day);
  if (candidate.getFullYear() !== year || candidate.getMonth() !== monthIndex || candidate.getDate() !== day) return undefined;
  return { year, monthIndex, day };
}

export function telegramDateTimestamp(date: TelegramCalendarDate, timeText?: string): number {
  const match = timeText?.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
  let hour = match ? Number(match[1]) : 12;
  const minute = match ? Number(match[2]) : 0;
  const meridiem = match?.[3]?.toUpperCase();
  if (meridiem === "AM") hour = hour === 12 ? 0 : hour;
  if (meridiem === "PM") hour = hour === 12 ? 12 : hour + 12;
  if (hour > 23 || minute > 59) return new Date(date.year, date.monthIndex, date.day, 12).getTime();
  return new Date(date.year, date.monthIndex, date.day, hour, minute).getTime();
}
