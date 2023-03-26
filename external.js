const file = "external.data"; // relative path to the file

let fileContents; // create a variable to store the file contents

fetch(file)
  .then(response => response.text())
  .then(contents => {
    fileContents = contents.replace(/\n/g, ''); // store the file contents in the variable
    console.log(fileContents);
    // do something with the file contents
  })
  .catch(error => console.log(error));

// the file contents can be accessed outside of the fetch() method
console.log(fileContents);
