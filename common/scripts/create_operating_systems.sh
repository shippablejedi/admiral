#!/bin/bash -e
export COMPONENT="db"
export DB_DATA_DIR="$RUNTIME_DIR/$COMPONENT/data"
export DB_CONFIG_DIR="$CONFIG_DIR/$COMPONENT"
export LOGS_FILE="$RUNTIME_DIR/logs/$COMPONENT.log"

## Write logs of this script to component specific file
exec &> >(tee -a "$LOGS_FILE")

__validate_db_envs() {
  __process_msg "Creating operating systems table"
  __process_msg "DB_DATA_DIR: $DB_DATA_DIR"
  __process_msg "DB_CONFIG_DIR: $DB_CONFIG_DIR"
  __process_msg "LOGS_FILE:$LOGS_FILE"
}

__copy_operating_systems() {
  __process_msg "Copying operating_systems.sql to db container"
  local host_location="$SCRIPTS_DIR/configs/operating_systems.sql"
  local container_location="$CONFIG_DIR/db/operating_systems.sql"
  sudo cp -vr $host_location $container_location

  __process_msg "Successfully copied operating_systems.sql to db container"
}
__upsert_operating_systems() {
  __process_msg "Upserting operating systems in db"

  local operating_systems_location="$DB_CONFIG_DIR/operating_systems.sql"
  local upsert_cmd="PGHOST=$DBHOST \
    PGPORT=$DBPORT \
    PGDATABASE=$DBNAME \
    PGUSER=$DBUSERNAME \
    PGPASSWORD=$DBPASSWORD \
    psql \
    -U $DBUSERNAME \
    -d $DBNAME \
    -h $DBHOST \
    -v ON_ERROR_STOP=1 \
    -f $operating_systems_location"

  eval "$upsert_cmd"
}

main() {
  __process_marker "Generating operating systems"
  __validate_db_envs
  __copy_operating_systems
  __upsert_operating_systems
}

main
