// Package crypto provides E2E encryption using NaCl box (Curve25519 + XSalsa20 + Poly1305).
// The same algorithm is implemented in the app using tweetnacl-js, ensuring cross-platform compatibility.
package crypto

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"

	"golang.org/x/crypto/nacl/box"
)

const (
	NonceSize = 24 // NaCl box nonce size
)

// KeyPair holds a NaCl box key pair for E2E encryption.
type KeyPair struct {
	PublicKey  [32]byte
	PrivateKey [32]byte
}

// GenerateKeyPair creates a new NaCl box key pair.
func GenerateKeyPair() (*KeyPair, error) {
	pub, priv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate keypair: %w", err)
	}
	return &KeyPair{PublicKey: *pub, PrivateKey: *priv}, nil
}

// PublicKeyBase64 returns the public key as base64 string (for sharing during pairing).
func (kp *KeyPair) PublicKeyBase64() string {
	return base64.StdEncoding.EncodeToString(kp.PublicKey[:])
}

// Encrypt encrypts a plaintext message for the given peer's public key.
// Returns (nonce_base64, ciphertext_base64, error).
func (kp *KeyPair) Encrypt(plaintext []byte, peerPublicKey *[32]byte) (string, string, error) {
	var nonce [NonceSize]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", "", fmt.Errorf("generate nonce: %w", err)
	}

	encrypted := box.Seal(nil, plaintext, &nonce, peerPublicKey, &kp.PrivateKey)

	nonceB64 := base64.StdEncoding.EncodeToString(nonce[:])
	cipherB64 := base64.StdEncoding.EncodeToString(encrypted)

	return nonceB64, cipherB64, nil
}

// Decrypt decrypts a ciphertext from the given peer's public key.
func (kp *KeyPair) Decrypt(nonceB64, ciphertextB64 string, peerPublicKey *[32]byte) ([]byte, error) {
	nonceBytes, err := base64.StdEncoding.DecodeString(nonceB64)
	if err != nil {
		return nil, fmt.Errorf("decode nonce: %w", err)
	}
	if len(nonceBytes) != NonceSize {
		return nil, errors.New("invalid nonce length")
	}

	ciphertext, err := base64.StdEncoding.DecodeString(ciphertextB64)
	if err != nil {
		return nil, fmt.Errorf("decode ciphertext: %w", err)
	}

	var nonce [NonceSize]byte
	copy(nonce[:], nonceBytes)

	plaintext, ok := box.Open(nil, ciphertext, &nonce, peerPublicKey, &kp.PrivateKey)
	if !ok {
		return nil, errors.New("decryption failed: invalid ciphertext or wrong key")
	}

	return plaintext, nil
}

// ParsePublicKey decodes a base64 public key string into a [32]byte array.
func ParsePublicKey(b64 string) (*[32]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("decode public key: %w", err)
	}
	if len(decoded) != 32 {
		return nil, errors.New("invalid public key length")
	}
	var key [32]byte
	copy(key[:], decoded)
	return &key, nil
}
