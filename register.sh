#!/bin/bash

URL="http://localhost:3000/register"

for i in $(seq 1 10000); do
    USERNAME="user_$i"
    FULLNAME="$(tr -dc 'A-Za-z ' </dev/urandom | head -c 10)" 
    EMAIL="email$RANDOM@domain.com"
    PASSWORD="12345"

    JSON_DATA=$(cat <<EOF
{
    "username": "$USERNAME",
    "fullname": "$FULLNAME",
    "email": "$EMAIL",
    "password": "$PASSWORD"
}
EOF
)

    curl -X POST -H "Content-Type: application/json" -d "$JSON_DATA" $URL &
done

wait
