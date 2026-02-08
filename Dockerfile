FROM node:20-bullseye-slim

WORKDIR /app

COPY . .

# Ensure devDependencies (Vite) are installed during build
RUN cd client && npm install --include=dev && npm run build
RUN cd server && npm install --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

WORKDIR /app/server
CMD ["npm", "start"]
