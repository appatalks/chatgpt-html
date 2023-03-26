// Inital External Data Discovery
const file = "external.data"; // relative path to the file
let fileContents; // create a variable to store the file contents

fetch(file)
  .then(response => response.text())
  .then(contents => {
    fileContents = contents.replace(/\n/g, ''); // store the file contents in the variable
  //  console.log(fileContents);
    // do something with the file contents
  })

// Test KeyWord Template "doh"
const doh = "doh.data"; // relative path to the file
let dohContents; // create a variable to store the file contents
 
 fetch(doh)
   .then(response => response.text())
   .then(contents => {
     dohContents = contents.replace(/\n/g, ''); // store the file contents in the variable
 //    console.log(dohContents);
     // do something with the file contents
   })

//
// Other Sources Template
// Check for keyword/phrase in sQuestion
