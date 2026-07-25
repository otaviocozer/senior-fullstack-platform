# Dev-oriented image for the take-home. Runs the Vite dev server so the proxy
# and HMR work against the backend `api` service on the compose network.
FROM node:24-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
# (Only package.json is copied; there is no committed lockfile in this take-home.)
COPY package.json ./
RUN npm install

# Copy the rest of the source.
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
