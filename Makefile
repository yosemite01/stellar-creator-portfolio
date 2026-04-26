.PHONY: help check-all check-backend check-contracts check-frontend lint-be test-be lint-fe

help:
	@echo "Available commands:"
	@echo "  make check-all       - Run all project lints and tests"
	@echo "  make check-backend   - Run Clippy and tests for backend services"
	@echo "  make check-contracts - Run tests for Soroban smart contracts"
	@echo "  make check-frontend  - Run linting and build for the Next.js frontend"
	@echo "  make lint-be         - Run cargo clippy on backend"
	@echo "  make test-be         - Run cargo tests on backend"
	@echo "  make lint-fe         - Run next lint on frontend"

check-all: check-frontend check-backend check-contracts

check-backend: lint-be test-be

check-contracts:
	@echo "Checking smart contracts..."
	cd backend && cargo test --all-features

check-frontend: lint-fe
	@echo "Checking frontend build..."
	npm run build

lint-be:
	@echo "Running clippy on backend..."
	cd backend && cargo clippy --workspace --all-targets --all-features -- -D warnings

test-be:
	@echo "Running backend tests..."
	cd backend && cargo test

lint-fe:
	@echo "Running frontend lint..."
	npm run lint
