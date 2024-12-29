#!/bin/bash

# backup_db.sh
# A script to backup a PostgreSQL database using a connection string.

# Exit immediately if a command exits with a non-zero status.
set -e

# Function to display usage instructions
usage() {
    echo "Usage: $0 <mode> <connection_string> [options]"
    echo ""
    echo "Modes:"
    echo "  backup   Create a backup of the specified PostgreSQL database."
    echo ""
    echo "Parameters for 'backup' mode:"
    echo "  -d, --directory    (Optional) Directory to store backup files. Defaults to './backups'"
    echo "  -f, --format       (Optional) Backup format: c (custom), p (plain SQL). Defaults to c"
    echo ""
    echo "Example:"
    echo "  Backup:"
    echo "    $0 backup \"postgresql://user:password@localhost:5432/mydatabase\" -d /path/to/backup_dir -f c"
    echo ""
    exit 1
}

# Function to perform backup
backup_db() {
    local CONN_STRING="$1"
    local BACKUP_DIR="$2"
    local FORMAT="$3"
    
    # Validate format
    if [[ "$FORMAT" != "c" && "$FORMAT" != "p" ]]; then
        echo "Error: Invalid format specified. Use 'c' for custom or 'p' for plain SQL."
        exit 1
    fi
    
    # Create backup directory if it doesn't exist
    mkdir -p "$BACKUP_DIR"
    
    # Generate timestamp for the backup filename
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    
    # Extract database name from connection string for the filename
    DB_NAME=$(echo "$CONN_STRING" | awk -F '/' '{print $NF}' | awk -F '?' '{print $1}')
    
    # Determine file extension based on format
    if [ "$FORMAT" == "c" ]; then
        EXT="dump"
        FORMAT_DESC="custom"
    else
        EXT="sql"
        FORMAT_DESC="plain SQL"
    fi
    
    # Define backup file path
    BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_backup_${TIMESTAMP}.${EXT}"
    
    # Inform the user about the backup process
    echo "Starting PostgreSQL backup..."
    echo "Database: $DB_NAME"
    echo "Backup Directory: $BACKUP_DIR"
    echo "Backup Format: $FORMAT_DESC"
    echo "Backup File: $BACKUP_FILE"
    
    # Execute pg_dump with the provided connection string
    pg_dump "$CONN_STRING" -F "$FORMAT" -f "$BACKUP_FILE"
    
    # Verify if pg_dump was successful
    if [ $? -eq 0 ]; then
        echo "Backup completed successfully at $BACKUP_FILE"
    else
        echo "Backup failed!"
        exit 1
    fi
}

# Main script logic
if [ $# -lt 2 ]; then
    usage
fi

MODE="$1"
CONN_STRING="$2"

shift 2  # Shift past mode and connection string

# Parse options based on mode
if [ "$MODE" == "backup" ]; then
    # Default values
    BACKUP_DIR="./backups"
    FORMAT="c"
    
    # Parse options
    while [[ $# -gt 0 ]]; do
        key="$1"
        case $key in
            -d|--directory)
                BACKUP_DIR="$2"
                shift
                shift
                ;;
            -f|--format)
                FORMAT="$2"
                shift
                shift
                ;;
            *)
                echo "Unknown option: $1"
                usage
                ;;
        esac
    done
    
    backup_db "$CONN_STRING" "$BACKUP_DIR" "$FORMAT"
    
    # Validate required options
    if [ -z "$BACKUP_FILE" ]; then
        echo "Error: --backup-file is required for restore mode."
        usage
    fi
    
    restore_db "$CONN_STRING" "$BACKUP_FILE" "$CREATE_DB"
    
else
    echo "Error: Unknown mode '$MODE'."
    usage
fi
