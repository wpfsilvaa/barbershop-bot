/**
 * Conversão de horário local do estabelecimento <-> UTC.
 *
 * Cópia deliberada de `backend/src/utils/datetime.ts`: os dois serviços são
 * pacotes npm independentes (sem workspace compartilhado), e o repositório já
 * duplica `config/db`, `config/redis` e `dbAuthStore` pelo mesmo motivo.
 * IMPORTANTE: as duas cópias precisam mudar juntas — se divergirem, o bot e o
 * portal web voltam a mostrar agendas diferentes.
 */

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

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

/** Converte "data + hora locais do estabelecimento" no instante UTC correspondente. */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string = APP_TIMEZONE): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  const naiveUtc = Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0, 0);

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
