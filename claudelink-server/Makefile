APP_NAME := claudelink-companion
VERSION := 0.1.0

# Build for all platforms
.PHONY: build build-all clean

build:
	go build -ldflags "-s -w -X main.version=$(VERSION)" -o bin/$(APP_NAME) ./cmd/companion

build-windows:
	GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -X main.version=$(VERSION)" -o bin/$(APP_NAME)-windows-amd64.exe ./cmd/companion

build-mac:
	GOOS=darwin GOARCH=amd64 go build -ldflags "-s -w -X main.version=$(VERSION)" -o bin/$(APP_NAME)-darwin-amd64 ./cmd/companion
	GOOS=darwin GOARCH=arm64 go build -ldflags "-s -w -X main.version=$(VERSION)" -o bin/$(APP_NAME)-darwin-arm64 ./cmd/companion

build-linux:
	GOOS=linux GOARCH=amd64 go build -ldflags "-s -w -X main.version=$(VERSION)" -o bin/$(APP_NAME)-linux-amd64 ./cmd/companion

build-all: build-windows build-mac build-linux

clean:
	rm -rf bin/

# Deploy relay to Cloudflare Workers
deploy-relay:
	cd relay && npx wrangler deploy

dev-relay:
	cd relay && npx wrangler dev
