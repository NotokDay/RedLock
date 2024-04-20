#!/bin/bash

URL="http://localhost:3000/buyTicket"

TOTAL_TICKETS=500
TICKET_ROWS=10
SEATS_PER_ROW=50

declare -a ticketIDs
index=0

# populate ticket IDs array
for (( row = 1; row <= TICKET_ROWS; row++ )); do
    for (( seat = 1; seat <= SEATS_PER_ROW; seat++ )); do
        ticketIDs[$index]="$row-$seat"
        ((index++))
    done
done

buy_ticket() {
    local username=$1
    local ticket=$2

    JSON_DATA=$(cat <<EOF
{
    "username": "$username",
    "ticketId": "$ticket"
}
EOF
)

    curl -X POST -H "Content-Type: application/json" -d "$JSON_DATA" $URL &
}

index=0
while [ $index -lt ${#ticketIDs[@]} ]; do
    # send sequencial requests, with valid ticket ids
    username="user_$(($RANDOM % 10000 + 1))"
    ticket="${ticketIDs[$index]}"
    buy_ticket "$username" "$ticket"
    #echo "Attempted to buy $ticket with username $username"
    ((index++))

    # send 5 to 10 random ticket purchases
    for i in $(seq 1 $((RANDOM % 6 + 5))); do
        randomTicket="${ticketIDs[$RANDOM % ${#ticketIDs[@]}]}"
        randomUser="user_$(($RANDOM % 10000 + 1))"
        buy_ticket "$randomUser" "$randomTicket"
        #echo "Attempted to buy $randomTicket with username $randomUser"
    done
done

echo "All ticket IDs have been attempted at least once."
