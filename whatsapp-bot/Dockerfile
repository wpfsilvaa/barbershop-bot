FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY node_modules ./node_modules
COPY dist ./dist

CMD ["node", "dist/index.js"]
