#!/bin/bash
# Generate GPG key for signing Linux packages
# Run this locally, then upload the key to GitHub Secrets

set -e

KEY_NAME="Together Release Signing Key"

echo "=== GPG Key Generator for Linux Signing ==="
echo ""
echo "This will create a GPG key for signing .deb, .rpm, and AppImage releases."
echo ""

read -p "Enter your name: " REAL_NAME
read -p "Enter your email: " EMAIL
read -p "Enter key expiration (e.g., 1y, 5y, or 0 for no expiration): " EXPIRATION

if [ "$EXPIRATION" = "0" ]; then
    EXPIRATION=""
fi

echo ""
echo "Creating GPG key..."
echo "  Name: $REAL_NAME"
echo "  Email: $EMAIL"
echo "  Expiration: ${EXPIRATION:-never}"
echo ""

# Generate the key
cat > /tmp/gpg-params <<EOF
%echo Generating GPG key
Key-Type: RSA
Key-Length: 4096
Key-Usage: sign
Subkey-Type: RSA
Subkey-Length: 4096
Subkey-Usage: sign
Name-Real: $REAL_NAME
Name-Comment: $KEY_NAME
Name-Email: $EMAIL
${EXPIRATION:+Expire-Date: $EXPIRATION}
%no-protection
%commit
%echo Done
EOF

gpg --batch --gen-key /tmp/gpg-params

# Get the key ID
KEY_ID=$(gpg --list-secret-keys --keyid-format=long "$EMAIL" | grep sec | awk '{print $2}' | cut -d'/' -f2)

echo ""
echo "=== GPG Key Created ==="
echo ""
echo "Key ID: $KEY_ID"
echo "Key fingerprint: $(gpg --fingerprint "$EMAIL" | grep -A1 pub | tail -1 | tr -d ' ')"
echo ""

# Export the keys
PRIVATE_KEY_FILE="together-signing-private.key"
PUBLIC_KEY_FILE="together-signing-public.asc"

gpg --armor --export-secret-keys "$KEY_ID" > "$PRIVATE_KEY_FILE"
gpg --armor --export "$KEY_ID" > "$PUBLIC_KEY_FILE"

echo "Keys exported:"
echo "  Private key: $PRIVATE_KEY_FILE (keep this secret!)"
echo "  Public key:  $PUBLIC_KEY_FILE (distribute freely)"
echo ""

# Convert to base64 for GitHub Secrets
PRIVATE_KEY_BASE64=$(base64 < "$PRIVATE_KEY_FILE")

echo "=== GitHub Secrets Setup ==="
echo ""
echo "Add these to your repository secrets:"
echo ""
echo "  GPG_PRIVATE_KEY_BASE64: (paste the contents of $PRIVATE_KEY_FILE)"
echo "  GPG_KEY_ID: $KEY_ID"
echo "  GPG_PASSPHRASE: (empty if you used %no-protection above)"
echo ""

# Show the public key
echo "=== Public Key (for APT repo verification) ==="
echo ""
cat "$PUBLIC_KEY_FILE"
echo ""

echo "Save the public key to distribute with your packages:"
echo "  - .deb: include in debian/ or host on your website"
echo "  - .rpm: users import with 'rpm --import'"
echo "  - AppImage: users verify with 'gpg --verify'"