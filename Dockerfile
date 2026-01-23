FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including devDependencies for build)
RUN npm install

# Copy source code
COPY . .

# Set build-time environment variables
ENV DEPLOY_TARGET=tencent
ENV DATABASE_URL="mysql://dummy:dummy@localhost:3306/dummy"

# Build the application
# This includes running adapt-schema.js and prisma generate as defined in package.json
RUN npm run build

# Expose port
EXPOSE 3000

# Start command
CMD ["npm", "run", "start:migrate"]
