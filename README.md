# Mrs. Turtle

Bot for Multiple Social Networking Platforms for Giving/Receiving Lotus to/from other Users.

## Current Build Tests
*Continuous Testing & Integration not implemented yet*

## Stable Releases

[Grab Stable Releases Here](https://github.com/givelotus/lotus-bot/releases)

Otherwise, you can clone this repo for pre-release development

## Requirements

- NodeJS 18.x (Recommend NodeJS repository for latest security updates: https://nodejs.org/en/download/package-manager/) (For Windows Admins: Make sure NodeJS is installed to the system $PATH)
- TypeScript ^4.x (Installed during `npm install`) (For Windows Admins: Install this manually & globally)
- Prisma ^4.8.x (Installed during `npm install`)
- sqlite3 package (Optional, Linux Only)
- PostgreSQL or MySQL Server (Optional, not implemented yet)

## Automatic Installation

(Linux Only)

### Install Script

Note: install.sh was written to be run on OpenSUSE / Ubuntu compatible systems. Modifications might be required to run.

Running the installation script will:  
  - Install the NPM dependencies
  - Set up Prisma and sqlite3 database
  - Install systemd services for the different platforms (e.g. Telegram, Twitter, etc.)

## Manual Install

In some cases manual install may be required for various reasons, manual install steps are provided below.

### Install (Linux)

1. Install sqlite3 per your distribution's package management system
2. Set up the folder to hold the repo - `sudo mkdir -p /opt/lotus-bot`
3. Clone the repo - `sudo git clone https://github.com/givelotus/lotus-bot.git /opt/lotus-bot`
4. Open the folder in your favorite terminal
5. Then `cp .env.example .env`
6. Modify `.env` with the required API key(s) for the bot(s) you want to run.
7. Install dependencies: `npm install`
8. Initialize the Database: `npx prisma migrate dev --name init`
9. (Optional) Enable Journaling for extra write performance: `sqlite3 ./prisma/dev.db 'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;'`
10. (Optional) Systemd is supported, you can install the service unit files in `lotus-bot/install`: `cp ./install/lotus-bot-*.service /etc/systemd/system` then reload systemd: `systemctl daemon-reload`

### Install (Windows)

1. Install typescript globally: `npm install typescript -g` (This will require Administrator Rights)
2. Setup a folder to hold the repo, example: `C:\Lotus\lotus-bot`
3. Clone the repo into said folder: `git clone https://github.com/givelotus/lotus-bot.git C:\Lotus\lotus-bot`
4. Open the folder in cmd or PowerShell
5. Then `copy .env.example .env`
6. Modify `.env` with the required API key(s) for the bot(s) you want to run.
7. Install dependencies: `npm install`
8. Initialize the Database: `npx prisma migrate dev --name init`

### Install (Mac)

1. TBD

## Runtime Notes

Notes for using the bot in it's specific social network or social area.

### Default Commands for [Twitter, Telegram, & Discord]

Commands required for all bots. These commands are for the user-space. These commands are not administrative in nature.

```
/balance .......... Get the XPI Balance of the current user.
/deposit .......... Start deposit with QR or lotus_ address.
/withdraw ......... Start withdraw to external wallet.
/give    .......... Give XPI to mentioned user.

# Syntax
/give <userToGiveTo> <amount>
/withdraw <amount> <externalWalletAddress>
```
In some cases, you can use `/give <amount>` as an alternative syntax when replying to a message in the Twitter & Telegram bot.


### Default Bot Account

On first launch, `lotus-bot` will generate an account, containing a `WalletKey`, for the bot itself. This account has a UUID of `00000000-0000-0000-0000-000000000000`. The address for this account is then displayed on the console after initialization. Bot has it's own wallet for transaction / withdrawal fees. You will see a notice about this when launching a bot manually. **Use this address to provide UTXOs for processing user withdrawals (i.e. transaction fees).**

### Write-Ahead Logging on sqlite3

We require the sqlite3 package in order to enable Write-Ahead Logging (WAL) on the Prisma-generated sqlite database. We do this so that you can run multiple instances of the bot on the same sqlite database (i.e. to safely handle simultaneous write operations).

More information about WAL can be found [here](https://www.sqlite.org/wal.html)

**WAL is enabled by default with Prisma on Windows[?]**

### Support / Questions

Reach out to `@maff1989` on Telegram & `maff1989#2504` Discord if you have any questions, run into issues, or need help with setup.

