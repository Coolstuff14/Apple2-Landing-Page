$(document).ready(function() {

  // use setTimeout() to execute
   setTimeout(banner, 1000)
   setTimeout(spinner, 2000)
   setTimeout(cli, 4000)


function banner(){
  $(".banner").css("visibility","visible");
}

function spinner(){
  $(".spinner").css("display","block");
}

function cli(){
  $(".spinner").css("display","none");
  const element = document.querySelector('.cli');
  typer(element)
    .line(['WebAdmin@jakeleeinfo ~$'], 1)
    .pause(1000)
    .continue('./main_menu.sh',{min: 40, max: 250})
    .pause(1000)
    .run(function(){$(".mm").css("display","block");})
    .end();
}

$(".back").click(function(){
  $('.contact-typed').html('');
  $(".back").css("display","none");
  $(".mm").css("display","block");
  //$('.cli div').html('');
  //cli()
});

/*
function typeit(){
    $(".cli").typed({
        strings: ["./main_menu.sh"],
        typeSpeed: 30, // typing speed
        backDelay: 750, // pause before backspacing
        loop: false, // loop on or off (true or false)
        callback: setTimeout(function () {$(".mm").css("display","block");},2000)
    });
}
*/


$(".contact").click(function(){
      $(".mm").css("display","none");
      //$(".contact-text").css("display","block");
      const element = document.querySelector('.contact-typed');
      typer(element)
        .line({container: ".contact-text"})
        .run(function(){$(".back").css("display","block")})
        .end();
});

    //Menu hover
    $(".hover").hover(function(){
        $(this).find(".pointer").css("visibility","visible");
      }, function(){
        $(this).find(".pointer").css("visibility","hidden");
      });

 });
