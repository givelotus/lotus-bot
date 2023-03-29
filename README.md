# lotus-bot v2.2.0

Bot for Multiple Social Networking Platforms for Giving/Receiving Lotus to/from other Users.

## Current Build Tests
*Continuous Testing & Integration not implemented yet*

## Requirements

- NodeJS 18.x (Recommend NodeJS repository for latest security updates: https://nodejs.org/en/download/package-manager/) (For Windows Admins: Make sure NodeJS is installed to the system $PATH)
- TypeScript ^4.x (Installed during `npm install`) (For Windows Admins: Install this manually & globally - `npm install -g typescript`)
- Prisma ^4.8.x (Installed during `npm install`)
- sqlite3 package (Optional, Linux Only)

## Automatic Installation - Linux

**IMPORTANT**: You will need to install `git` and `sqlite3` on your system

To run the automated install, paste and execute the following command in your terminal: `curl https://raw.githubusercontent.com/givelotus/lotus-bot/main/install.sh | sudo bash`

After the installation completes, you will need to edit your `/opt/lotus-bot/.env` file to fill in the appropriate values for your platform!

The `install.sh` script will:  
  - Clone this repository to `/opt/lotus-bot` directory
  - Create a new system user with the repository as its `$HOME` folder and ensure proper permissions
  - Create the `.env` config file
  - Install NPM dependencies
  - Set up Prisma and sqlite3 database
  - Install systemd service

## Manual Install

If you prefer to not run the Automatic Install, or if you are running Windows, follow the below prcoedure.

### Install (Linux)

1. Install sqlite3 per your distribution's package management system
2. Set up the folder to hold the repo - `sudo mkdir -p /opt/lotus-bot`
3. Clone the repo - `sudo git clone https://github.com/givelotus/lotus-bot.git /opt/lotus-bot`
4. Open the folder in your favorite terminal
5. Then `cp .env.example .env`
6. Modify `.env` with the required API key(s) for the bot(s) you want to run.
7. Install dependencies: `npm install`
8. Initialize the Database:
```
npx prisma migrate dev --name init
sqlite3 ./prisma/dev.db 'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;'
```
9. systemd is supported, you can install the service unit from the `install/` folder:
```
sudo cp ./install/lotus-bot.service /etc/systemd/system
sudo systemctl daemon-reload
```

### Install (Windows)

1. Install typescript globally: `npm install -g typescript` (This will require Administrator Rights)
2. Setup a folder to hold the repo, example: `C:\Lotus\lotus-bot`
3. Clone the repo into said folder: `git clone https://github.com/givelotus/lotus-bot.git C:\Lotus\lotus-bot`
4. Open the folder in cmd or PowerShell
5. Then `copy .env.example .env`
6. Modify `.env` with the required API key(s) for the bot(s) you want to run.
7. Install dependencies: `npm install`
8. Initialize the Database:
```
npx prisma migrate dev --name init
sqlite3 ./prisma/dev.db 'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;'
```

### Install (Mac)

1. TBD

## Runtime Notes

### Default Platform Commands

These commands are for the user-space; they are not administrative in nature.

```
balance .......... Check your Lotus balance
deposit .......... Deposit Lotus to your account
withdraw ......... Withdraw Lotus to your wallet address
link    .......... Connect platform accounts to share a wallet balance
give    .......... Give Lotus to another user
```

### On-Chain Giving

Starting with v2.1.0, the "give" interaction of lotus-bot is now done on-chain. The Give database table is now simply used for tracking gives rather than for calculating user balances. User balances are now calculated solely by the UTXOs of the user's `WalletKey`. 

### Write-Ahead Logging on sqlite3

We require the sqlite3 package in order to enable Write-Ahead Logging (WAL) on the Prisma-generated sqlite database. We do this so that you can run multiple instances of the bot on the same sqlite database (i.e. to safely handle simultaneous write operations).

More information about WAL can be found [here](https://www.sqlite.org/wal.html)

**NOTE**: Since v2.0.0, WAL is no longer required, but the PRAGMA changes are still part of the install for helping ensure database integrity.

**WAL is enabled by default with Prisma on Windows[?]**

### Support / Questions

Telegram: `@maff1989`  
Discord: `maff1989#2504`