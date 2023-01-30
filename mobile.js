// Javascript for Mobile
// Get the user agent string and adjust for Mobile

function mobile_txtout() {
	window.addEventListener("load", function() {
	let textarea = document.getElementById("txtOutput");
	let userAgent = navigator.userAgent;
	if (userAgent.indexOf("iPhone") !== -1 || userAgent.indexOf("Android") !== -1 || userAgent.indexOf("Mobile") !== -1) {
   	   textarea.setAttribute("rows", "15");
   	   textarea.style.width = "90%";
   	   textarea.style.height = "auto";
 	} else {
  	  // Use Defaults
 	  }
	})
};

function mobile_txtmsd() {
 	window.addEventListener("load", function() {
  	let textarea2 = document.getElementById("txtMsg");
  	let userAgent = navigator.userAgent;
 	if (userAgent.indexOf("iPhone") !== -1 || userAgent.indexOf("Android") !== -1 || userAgent.indexOf("Mobile") !== -1) {
   	   textarea2.setAttribute("rows", "7");
      	   textarea2.style.width = "90%";
   	   textarea2.style.height = "auto";
 	} else {
   	  //  Use defaults
 	  }
	})
};

function useragent_adjust() {
      	var userAgent = navigator.userAgent;
      	if (userAgent.match(/Android|iPhone|Mobile/)) {
            var style = document.createElement("style");
            style.innerHTML = "body { overflow: scroll; background-color: ; width: auto; height: 90%; background-image: url(https://hoshisato.com/ai/generated/page/2/upscale/768-026.jpeg); margin: ; display: grid; align-items: center; justify-content: center; background-repeat: repeat; background-position: center center; background-size: initial; }";
            document.head.appendChild(style);
      	}
};
