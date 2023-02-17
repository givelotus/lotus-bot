#/bin/bash
USER=lotus-bot
INSTALLDIR=/opt
HOMEDIR="$INSTALLDIR/lotus-bot"

# Fail if not root
if [ $(whoami) != "root" ];
then
  echo "You must run this script with sudo or as root"
  exit 1
fi

# Set up and clone the repo
mkdir -p $INSTALLDIR
git clone https://github.com/givelotus/lotus-bot.git $HOMEDIR

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
cp ./install/lotus-bot.service /etc/systemd/system
systemctl daemon-reload
