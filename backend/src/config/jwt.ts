import dotenv from 'dotenv';

dotenv.config();

const rawSecret = process.env.JWT_SECRET;
const isProduction = process.env.NODE_ENV === 'production';

// Fail-secure: sem segredo forte a aplicação não sobe em produção.
// Segredos hardcoded de fallback permitiriam a qualquer pessoa forjar tokens
// de qualquer papel (admin inclusive), então nunca existe valor padrão.
if (!rawSecret || rawSecret.trim().length < 32) {
  const message =
    'JWT_SECRET ausente ou fraco. Defina JWT_SECRET com no mínimo 32 caracteres aleatórios ' +
    '(ex.: `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"`).';

  if (isProduction) {
    throw new Error(message);
  }
  console.error(`[SECURITY] ${message} A aplicação só continua por estar fora de produção.`);
}

// Em desenvolvimento geramos um segredo efêmero: os tokens deixam de valer a cada
// restart (incômodo proposital), mas nunca há um segredo previsível em uso.
export const JWT_SECRET: string =
  rawSecret && rawSecret.trim().length >= 32
    ? rawSecret
    : require('crypto').randomBytes(48).toString('hex');

export const JWT_STAFF_EXPIRATION = '8h';
export const JWT_CLIENT_EXPIRATION = '30d';
