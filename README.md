# Mrs. Turtle
Bot for Multiple Social Networking Platforms for Giving/Receiving Lotus to/from other Users

### Requirements
- NodeJS 18.x
- TypeScript ^4.x
- Prisma ^4.8.x
- sqlite3 package (provided by your distribution)

### Install
1. Install sqlite3 per your distribution's package management system
2. Set up the folder to hold the repo - `sudo mkdir -p /opt/lotus-bot`
3. Clone the repo - `sudo git clone https://github.com/givelotus/lotus-bot.git /opt/lotus-bot`
4. Change into directory and run installation script - `cd /opt/lotus-bot && sudo ./install.sh`

Running the installation script will:  
  - Install the NPM dependencies
  - Set up Prisma and sqlite3 database
  - Install systemd services for the different platforms (e.g. Telegram, Twitter, etc.)

### Runtime Notes
#### Default Bot Account
On first launch, `lotus-bot` will generate an account, containing a `WalletKey`, for the bot itself. This account has a UUID of `00000000-0000-0000-0000-000000000000`. The address for this account is then displayed on the console after initialization. **Use this address to provide UTXOs for processing user withdrawals (i.e. transaction fees).**

#### Write-Ahead Logging on sqlite3
We require the sqlite3 package in order to enable Write-Ahead Logging (WAL) on the Prisma-generated sqlite database. We do this so that you can run multiple instances of the bot on the same sqlite database (i.e. to safely handle simultaneous write operations).

More information about WAL can be found [here](https://www.sqlite.org/wal.html)

### Support / Questions
Reach out to @maff1989 on Telegram/Discord if you have any questions, run into issues, or need help with setup.

