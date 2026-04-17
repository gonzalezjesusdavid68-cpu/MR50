var requestOptions = {
  method: 'GET',
  redirect: 'follow'
};
fetch("http://backend:5000/getMyInfo", requestOptions)
  .then(res => {
    if (!res.ok) {
        alert("HTTP error! status: " + res.status);
    } 
    return res.json();
    })
  .then(json => {
    document.getElementById("name").textContent= "Hola" + json.name + "" + json.lastname;
    document.getElementById("author").textContent= "2025 - Hecho por" + json.author;
    document.getElementById("facebookLink").href= "https//www.facebook.com/" + json.socialMedia.facebookUser;
    document.getElementById("instagramLink").href= "https//www.instagram.com/" + json.socialMedia.instagramUser;    
    document.getElementById("githubUser").href= "https//www.github.com/" + json.socialMedia.githubUser;     
    document.getElementById("website").href= json.blog;
})
.catch(error => alert('error:' + error));