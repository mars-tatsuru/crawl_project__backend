FROM node:20

WORKDIR /app

# Update the package lists and install necessary dependencies
# この依存関係がないと、Playwrightがブラウザを起動できない
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    libgconf-2-4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libgdk-pixbuf2.0-0 \
    libgtk-3-0 \
    libgbm-dev \
    libnss3-dev \
    libxss-dev \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

# Install Playwright and its dependencies
# flyioでエラーが出てたので、Playwrightの依存関係をインストール
RUN npx playwright install-deps
RUN npx playwright install chromium

COPY . .

EXPOSE 8000

CMD ["npm", "start"]
