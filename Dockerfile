FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
ENV ELSET_DATA_DIR=/app/data

EXPOSE 8080

CMD ["npm", "start"]
