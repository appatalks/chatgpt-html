#!/bin/bash

# Get today's date
today=$(date +"%A, %B %dth, %Y")

# Get the weather for San Antonio, Texas using wttr.in API
weather=$(curl -s "wttr.in/San+Antonio?format=%C+%t\n" | awk '{printf("%s %.0f°F\n",$1,($2*1.8)+32)}')

# Get the top 5 news headlines using Google News API
news=$(curl -s "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en" | xmlstarlet sel -t -m "//item[position()<=5]" -v "title" -n | sed -E 's/&apos;/\x27/g' | sed -E 's/&amp;/\&/g')

# SPY Performace
spy_price=$(curl -s "https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d" | jq '.chart.result[0].meta.regularMarketPrice')

# Marketpulse by Marketwatch.com
marketpulse=$(curl -s "http://feeds.marketwatch.com/marketwatch/marketpulse/" | xmlstarlet sel -t -m "//item[position()<=5]" -v "title" -o $'\n' | sed 's/: *//g; s/$/./g')

# Write the data to external.data file
echo "Today's date: $today " > external.data
echo "Weather for San Antonio, Texas: $weather " >> external.data
echo "The SPY ticker price is: $spy_price " >> external.data
echo "Top 5 news headlines: " >> external.data
echo "$news " >> external.data
echo "Top 5 market headlines: " >> external.data
echo "$marketpulse " >> external.data
