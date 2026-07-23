/**
 * Conversão de horário local do estabelecimento <-> UTC.
 *
 * Bug original: `opening_time`/`closing_time` são horários locais da barbearia,
 * mas os slots eram montados de duas formas incompatíveis:
 *   - backend  (`getAvailableSlots`): `new Date("2026-07-23T09:00")` → fuso do processo
 *   - bot      (`botEngineWorker`)  : `new Date("2026-07-23T09:00:00.000Z")` → UTC puro
 *
 * Resultado: o mesmo horário de funcionamento gerava agendas diferentes no bot e
 * no portal web, com deslocamento de até 3 horas. Este módulo centraliza a regra
 * para que ambos os lados concordem, sem dependências externas (usa Intl).
 */

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

/** Offset (ms) do fuso informado no instante dado. Positivo a leste de Greenwich. */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );

  return asIfUtc - instant.getTime();
}

/**
 * Converte "data + hora locais do estabelecimento" no instante UTC correspondente.
 * @param dateStr YYYY-MM-DD
 * @param timeStr HH:MM ou HH:MM:SS
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string = APP_TIMEZONE): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  const naiveUtc = Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0, 0);

  // Duas passadas resolvem a ambiguidade em bordas de horário de verão.
  let offset = timeZoneOffsetMs(new Date(naiveUtc), timeZone);
  let instant = naiveUtc - offset;
  offset = timeZoneOffsetMs(new Date(instant), timeZone);
  instant = naiveUtc - offset;

  return new Date(instant);
}

/** Partes de data/hora de um instante, já no fuso do estabelecimento. */
export function toZonedParts(
  instant: Date | string,
  timeZone: string = APP_TIMEZONE
): { date: string; time: string; day: number; month: number; year: number; hour: number; minute: number } {
  const dateObj = instant instanceof Date ? instant : new Date(instant);

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(dateObj)) {
    parts[part.type] = part.value;
  }

  const hour = Number(parts.hour) % 24;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(hour).padStart(2, '0')}:${parts.minute}`,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
  };
}

/** Formata como DD/MM/AAAA e HH:MM no fuso do estabelecimento. */
export function formatZoned(
  instant: Date | string,
  timeZone: string = APP_TIMEZONE
): { date: string; time: string } {
  const parts = toZonedParts(instant, timeZone);
  return {
    date: `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`,
    time: parts.time,
  };
}
