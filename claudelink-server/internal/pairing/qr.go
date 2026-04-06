// Package pairing handles device pairing via QR code.
// The QR code contains the session ID, relay URL, and companion's public key.
// The phone scans this QR code to establish an E2E encrypted connection.
package pairing

import (
	"encoding/json"
	"fmt"

	qrcode "github.com/skip2/go-qrcode"
)

// PairingData is encoded into the QR code for the phone to scan.
type PairingData struct {
	SessionID string `json:"s"`  // Short key names to keep QR small
	RelayURL  string `json:"r"`
	PublicKey string `json:"k"`  // Companion's NaCl public key (base64)
	Version   int    `json:"v"`  // Protocol version
}

// GenerateQRCode creates a QR code PNG containing the pairing data.
// Returns the PNG bytes.
func GenerateQRCode(sessionID, relayURL, publicKey string) ([]byte, error) {
	data := PairingData{
		SessionID: sessionID,
		RelayURL:  relayURL,
		PublicKey: publicKey,
		Version:   1,
	}

	jsonBytes, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("marshal pairing data: %w", err)
	}

	png, err := qrcode.Encode(string(jsonBytes), qrcode.Medium, 256)
	if err != nil {
		return nil, fmt.Errorf("generate QR code: %w", err)
	}

	return png, nil
}

// GenerateQRTerminal creates a QR code suitable for terminal display.
func GenerateQRTerminal(sessionID, relayURL, publicKey string) (string, error) {
	data := PairingData{
		SessionID: sessionID,
		RelayURL:  relayURL,
		PublicKey: publicKey,
		Version:   1,
	}

	jsonBytes, err := json.Marshal(data)
	if err != nil {
		return "", fmt.Errorf("marshal pairing data: %w", err)
	}

	qr, err := qrcode.New(string(jsonBytes), qrcode.Medium)
	if err != nil {
		return "", fmt.Errorf("generate QR code: %w", err)
	}

	return qr.ToSmallString(false), nil
}
