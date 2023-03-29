// Inital External Data Discovery

// Current Date
const dateFile = "date.data"; // relative path to the file
let dateContents; // create a variable to store the file contents
fetch(dateFile)
  .then(response => response.text())
  .then(contents => {
    dateContents = contents.replace(/\n/g, ''); // store the file contents in the variable
  })

// Weather Report
const weatherFile = "weather.data";
let weatherContents; 
 fetch(weatherFile)
   .then(response => response.text())
   .then(contents => {
     weatherContents = contents.replace(/\n/g, '');
   })

// Top Headline News
const newsFile = "news.data";
let newsContents; 
 fetch(newsFile)
   .then(response => response.text())
   .then(contents => {
     newsContents = contents.replace(/\n/g, '');
   })

// Top Market Headlines
const marketFile = "market.data"; 
let marketContents; 
 fetch(marketFile)
   .then(response => response.text())
   .then(contents => { 
     marketContents = contents.replace(/\n/g, '');
   })

// Latest Solar Weather 
const solarFile = "solar.data";
let solarContents;
 fetch(solarFile)
   .then(response => response.text())
   .then(contents => {
     solarContents = contents.replace(/\n/g, '');
   })
