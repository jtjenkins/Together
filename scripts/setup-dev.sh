#!/bin/bash
# Development Environment Setup Script
# Sets up Rust, sqlx-cli, and PostgreSQL for Together development

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🚀 Setting up Together development environment${NC}\n"

# Check for Rust
if ! command -v cargo &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Rust...${NC}"
    if curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y; then
        if source "$HOME/.cargo/env" 2>/dev/null; then
            if command -v cargo &> /dev/null; then
                echo -e "${GREEN}✅ Rust installed successfully${NC}\n"
            else
                echo -e "${RED}❌ Rust installed but cargo not in PATH${NC}"
                echo "Please restart your shell or run: source \$HOME/.cargo/env"
                exit 1
            fi
        else
            echo -e "${RED}❌ Failed to source Rust environment${NC}"
            echo "Try manually: source \$HOME/.cargo/env"
            exit 1
        fi
    else
        echo -e "${RED}❌ Rust installation failed${NC}"
        echo "Please install manually: https://rustup.rs"
        exit 1
    fi
else
    echo -e "${GREEN}✅ Rust already installed${NC}\n"
fi

# Check for sqlx-cli
if ! command -v sqlx &> /dev/null; then
    echo -e "${YELLOW}📦 Installing sqlx-cli (this may take 5-10 minutes)...${NC}"
    if cargo install sqlx-cli --no-default-features --features postgres; then
        if command -v sqlx &> /dev/null; then
            echo -e "${GREEN}✅ sqlx-cli installed successfully${NC}\n"
        else
            echo -e "${RED}❌ sqlx installed but not in PATH${NC}"
            echo "Restart your shell or run: source \$HOME/.cargo/env"
            exit 1
        fi
    else
        echo -e "${RED}❌ Failed to install sqlx-cli${NC}"
        echo ""
        echo "Common causes:"
        echo "  - Missing OpenSSL development headers (install libssl-dev)"
        echo "  - Missing PostgreSQL client libraries (install libpq-dev)"
        echo "  - Network issues downloading dependencies"
        echo ""
        echo "Manual installation: cargo install sqlx-cli --no-default-features --features postgres"
        exit 1
    fi
else
    echo -e "${GREEN}✅ sqlx-cli already installed${NC}\n"
fi

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found${NC}"
    echo "Please install Docker Desktop: https://www.docker.com/products/docker-desktop"
    exit 1
fi
echo -e "${GREEN}✅ Docker found${NC}\n"

# Start PostgreSQL
echo -e "${YELLOW}🐘 Starting PostgreSQL container...${NC}"
if ! docker-compose -f docker-compose.dev.yml up -d; then
    echo -e "${RED}❌ Failed to start PostgreSQL container${NC}"
    echo ""
    echo "Common causes:"
    echo "  - Docker daemon not running (start Docker Desktop)"
    echo "  - Port 5432 already in use (check: lsof -i :5432)"
    echo "  - Permission errors with Docker socket"
    echo ""
    exit 1
fi

# Wait for PostgreSQL to be ready with proper polling
echo -e "${YELLOW}⏳ Waiting for PostgreSQL to be ready...${NC}"
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
    if docker-compose -f docker-compose.dev.yml exec -T postgres pg_isready -U together &> /dev/null; then
        echo -e "${GREEN}✅ PostgreSQL is ready${NC}\n"
        break
    fi
    attempt=$((attempt + 1))
    if [ $attempt -eq $max_attempts ]; then
        echo -e "${RED}❌ PostgreSQL failed to become ready after 30 seconds${NC}"
        echo ""
        echo "Check logs: docker-compose -f docker-compose.dev.yml logs postgres"
        echo "Container may have crashed or failed to start"
        exit 1
    fi
    sleep 1
done

# Run migrations
echo -e "${YELLOW}📊 Running database migrations...${NC}"
cd server

# Load environment variables
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}✅ Created .env from template${NC}"
fi

# Source the .env file safely
if [ -f .env ]; then
    set -a
    source .env
    set +a

    if [ -z "$DATABASE_URL" ]; then
        echo -e "${RED}❌ DATABASE_URL not found in .env${NC}"
        echo "Please ensure server/.env contains:"
        echo "  DATABASE_URL=postgresql://together:together_dev_password@localhost:5432/together_dev"
        exit 1
    fi
else
    echo -e "${RED}❌ .env file not found${NC}"
    echo "Expected: server/.env"
    exit 1
fi

# Create database if it doesn't exist
echo -e "${YELLOW}📊 Creating database...${NC}"
if ! sqlx database create 2>&1 | grep -q "already exists"; then
    if ! sqlx database create; then
        echo -e "${RED}❌ Failed to create database${NC}"
        echo "Check DATABASE_URL in server/.env"
        echo "Ensure PostgreSQL is running and accessible"
        exit 1
    fi
fi

# Run migrations
if ! sqlx migrate run; then
    echo -e "${RED}❌ Migration failed${NC}"
    echo ""
    echo "Possible causes:"
    echo "  - Syntax error in migration file"
    echo "  - Constraint violation from seed data"
    echo "  - Duplicate migration application"
    echo ""
    echo "Debug: sqlx migrate info"
    echo "Rollback: sqlx migrate revert"
    exit 1
fi

# Verify migrations succeeded
echo -e "${YELLOW}🔍 Verifying migration results...${NC}"
for table in users servers channels messages; do
    if ! docker-compose -f ../docker-compose.dev.yml exec -T postgres \
         psql -U together -d together_dev \
         -c "SELECT 1 FROM $table LIMIT 1" &> /dev/null; then
        echo -e "${RED}❌ Table '$table' not found or empty${NC}"
        echo "Migration may have failed. Check: sqlx migrate info"
        exit 1
    fi
done

# Check seed data loaded
user_count=$(docker-compose -f ../docker-compose.dev.yml exec -T postgres \
             psql -U together -d together_dev -t \
             -c "SELECT COUNT(*) FROM users" | xargs)

if [ "$user_count" -lt 5 ]; then
    echo -e "${YELLOW}⚠️  Expected 5 test users, found $user_count${NC}"
    echo "Seed data may not have loaded correctly"
fi

echo -e "${GREEN}✅ Database verification passed${NC}\n"

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
