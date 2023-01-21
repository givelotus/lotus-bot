#/bin/bash
USER=lotus-bot
HOMEDIR=/opt/lotus-bot

# Fail if not root
if [ $(whoami) != "root" ];
then
  echo "Please run this script with: sudo ./install.sh"
  exit 1
fi

# Create bot user
useradd \
  --home-dir $HOMEDIR \
  --no-create-home \
  --shell /bin/false \
  --system \
  $USER

# Create bot home folder and set ownership
GROUP=$(cat /etc/passwd | grep $USER | cut -d ':' -f 4)
chown -R $USER:$GROUP $HOMEDIR

# Run as bot user to set up repository and run INSTALL_COMMAND
sudo -u $USER cp .env.example .env
sudo -u $USER npm install
sudo -u $USER npx prisma migrate dev --name init
sudo -u $USER sqlite3 ./prisma/dev.db 'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;'

# Install service files
cp ./install/lotus-bot-*.service /etc/systemd/system
systemctl daemon-reload
