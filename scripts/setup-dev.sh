#!/bin/bash
# Development Environment Setup Script
# Sets up Rust, sqlx-cli, and PostgreSQL for Together development

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🚀 Setting up Together development environment${NC}\n"

# Check for Rust
if ! command -v cargo &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Rust...${NC}"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    echo -e "${GREEN}✅ Rust installed${NC}\n"
else
    echo -e "${GREEN}✅ Rust already installed${NC}\n"
fi

# Check for sqlx-cli
if ! command -v sqlx &> /dev/null; then
    echo -e "${YELLOW}📦 Installing sqlx-cli (this may take a few minutes)...${NC}"
    cargo install sqlx-cli --no-default-features --features postgres
    echo -e "${GREEN}✅ sqlx-cli installed${NC}\n"
else
    echo -e "${GREEN}✅ sqlx-cli already installed${NC}\n"
fi

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}⚠️  Docker not found. Please install Docker Desktop:${NC}"
    echo "   https://www.docker.com/products/docker-desktop"
    exit 1
fi
echo -e "${GREEN}✅ Docker found${NC}\n"

# Start PostgreSQL
echo -e "${YELLOW}🐘 Starting PostgreSQL container...${NC}"
docker-compose -f docker-compose.dev.yml up -d

echo -e "${YELLOW}⏳ Waiting for PostgreSQL to be ready...${NC}"
sleep 5

# Run migrations
echo -e "${GREEN}📊 Running database migrations...${NC}"
cd server

# Load environment variables
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}✅ Created .env from template${NC}"
fi

# Source the .env file to get DATABASE_URL
export $(grep -v '^#' .env | xargs)

sqlx database create 2>/dev/null || true
sqlx migrate run

echo -e "\n${GREEN}✅ Setup complete!${NC}\n"
echo "Database is running with seed data:"
echo "  - 5 test users (alice, bob, charlie, diana, eve)"
echo "  - Password for all: password123"
echo "  - 1 test server: Gaming Squad"
echo "  - 7 channels (4 text, 3 voice)"
echo ""
echo "Useful commands:"
echo "  cd server && sqlx migrate run      # Run migrations"
echo "  cd server && sqlx migrate revert   # Rollback last migration"
echo "  cd server && sqlx migrate info     # Show migration status"
echo "  docker-compose -f docker-compose.dev.yml logs -f  # View database logs"
