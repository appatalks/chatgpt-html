#!/bin/bash

# Set File Path
filepath=/var/www/html

# Get today's date
today=$(date +"%A, %B %dth, %Y")

# Get the weather for San Antonio, Texas using wttr.in API
weather=$(curl -s "wttr.in/San+Antonio?format=%C+%t\n")

# Get the top 5 news headlines using Google News API
news=$(curl -s "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en" | xmlstarlet sel -t -m "//item[position()<=5]" -v "title" -n | sed -E 's/&apos;/\x27/g' | sed -E 's/&amp;/\&/g')

# Ticker Performaces
spy_price=$(curl -s "https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d" | jq -r '.chart.result[0].meta | "Price: \(.regularMarketPrice) Change: " + (100 * (.regularMarketPrice - .chartPreviousClose) / .chartPreviousClose | tostring | split(".") | .[0] + "." + .[1][:3]) + "%"')
gold_price=$(curl -s "https://query1.finance.yahoo.com/v8/finance/chart/GOLD?interval=1d" | jq -r '.chart.result[0].meta | "Price: \(.regularMarketPrice) Change: " + (100 * (.regularMarketPrice - .chartPreviousClose) / .chartPreviousClose | tostring | split(".") | .[0] + "." + .[1][:3]) + "%"')
hmy_price=$(curl -s "https://query1.finance.yahoo.com/v8/finance/chart/HMY?interval=1d" | jq -r '.chart.result[0].meta | "Price: \(.regularMarketPrice) Change: " + (100 * (.regularMarketPrice - .chartPreviousClose) / .chartPreviousClose | tostring | split(".") | .[0] + "." + .[1][:3]) + "%"')
weat_price=$(curl -s "https://query1.finance.yahoo.com/v8/finance/chart/WEAT?interval=1d" | jq -r '.chart.result[0].meta | "Price: \(.regularMarketPrice) Change: " + (100 * (.regularMarketPrice - .chartPreviousClose) / .chartPreviousClose | tostring | split(".") | .[0] + "." + .[1][:3]) + "%"')
onl_price=$(curl -s "https://query1.finance.yahoo.com/v8/finance/chart/ONL?interval=1d" | jq -r '.chart.result[0].meta | "Price: \(.regularMarketPrice) Change: " + (100 * (.regularMarketPrice - .chartPreviousClose) / .chartPreviousClose | tostring | split(".") | .[0] + "." + .[1][:3]) + "%"')
vet_price=$(curl -s "https://query1.finance.yahoo.com/v8/finance/chart/VET?interval=1d" | jq -r '.chart.result[0].meta | "Price: \(.regularMarketPrice) Change: " + (100 * (.regularMarketPrice - .chartPreviousClose) / .chartPreviousClose | tostring | split(".") | .[0] + "." + .[1][:3]) + "%"')
mmm_price=$(curl -s "https://query1.finance.yahoo.com/v8/finance/chart/MMM?interval=1d" | jq -r '.chart.result[0].meta | "Price: \(.regularMarketPrice) Change: " + (100 * (.regularMarketPrice - .chartPreviousClose) / .chartPreviousClose | tostring | split(".") | .[0] + "." + .[1][:3]) + "%"')
dow_price=$(curl -s "https://query1.finance.yahoo.com/v8/finance/chart/DOW?interval=1d" | jq -r '.chart.result[0].meta | "Price: \(.regularMarketPrice) Change: " + (100 * (.regularMarketPrice - .chartPreviousClose) / .chartPreviousClose | tostring | split(".") | .[0] + "." + .[1][:3]) + "%"')
qyld_price=$(curl -s "https://query1.finance.yahoo.com/v8/finance/chart/QYLD?interval=1d" | jq -r '.chart.result[0].meta | "Price: \(.regularMarketPrice) Change: " + (100 * (.regularMarketPrice - .chartPreviousClose) / .chartPreviousClose | tostring | split(".") | .[0] + "." + .[1][:3]) + "%"')
ryld_price=$(curl -s "https://query1.finance.yahoo.com/v8/finance/chart/RYLD?interval=1d" | jq -r '.chart.result[0].meta | "Price: \(.regularMarketPrice) Change: " + (100 * (.regularMarketPrice - .chartPreviousClose) / .chartPreviousClose | tostring | split(".") | .[0] + "." + .[1][:3]) + "%"')

# Marketpulse by Marketwatch.com
marketpulse=$(curl -s "http://feeds.marketwatch.com/marketwatch/marketpulse/" | xmlstarlet sel -t -m "//item[position()<=5]" -v "title" -o $'\n' | sed 's/: *//g; s/$/./g')

# Solar Space Weather Report
spaceweather=$(curl -s https://services.swpc.noaa.gov/products/alerts.json | jq -r '.[] | "\(.product_id),\(.issue_datetime),\(.message)"' | tr '\n' '\n' | head -n40)


# Write the data to external.data file
#
#
echo "Today's date: $today " > $filepath/date.data

echo "Weather for San Antonio, Texas: $weather " > $filepath/weather.data

echo "Top 5 news headlines: " > $filepath/news.data
echo "$news " >> $filepath/news.data

echo "Top 5 market headlines: " > $filepath/market.data
echo "$marketpulse " >> $filepath/market.data 
echo "SPY ticker $spy_price " >> $filepath/market.data
echo "GOLD ticker $gold_price " >> $filepath/market.data
echo "HMY ticker $hmy_price " >> $filepath/market.data
echo "WEAT ticker $weat_price " >> $filepath/market.data
echo "ONL ticker $onl_price " >> $filepath/market.data
echo "VET ticker $vet_price " >> $filepath/market.data
echo "MMM ticker $mmm_price " >> $filepath/market.data
echo "DOW ticker $dow_price " >> $filepath/market.data
echo "QYLD ticker $qyld_price " >> $filepath/market.data
echo "RYLD ticker $ryld_price " >> $filepath/market.data

echo "Current Space Weather Reprot: $spaceweather " > $filepath/solar.data
