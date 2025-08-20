const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const messageDiv = document.getElementById('message');

const player = {
    x: canvas.width / 2,
    y: canvas.height - 30,
    width: 20,
    height: 20,
    color: 'blue',
    speed: 5
};

const people = [];
const numPeople = 10;

for (let i = 0; i < numPeople; i++) {
    people.push({
        x: Math.random() * canvas.width,
        y: Math.random() * (canvas.height - 100),
        width: 20,
        height: 20,
        color: 'red',
        speed: Math.random() * 2 + 1
    });
}

function drawPlayer() {
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x, player.y, player.width, player.height);
}

function drawPeople() {
    ctx.fillStyle = 'red';
    for (const person of people) {
        ctx.fillRect(person.x, person.y, person.width, person.height);
    }
}

function movePeople() {
    for (const person of people) {
        person.y += person.speed;
        if (person.y > canvas.height) {
            person.y = 0;
            person.x = Math.random() * canvas.width;
        }
    }
}

function checkCollision() {
    for (const person of people) {
        const dist = Math.sqrt(Math.pow(player.x - person.x, 2) + Math.pow(player.y - person.y, 2));
        if (dist < player.width) {
            return dist;
        }
    }
    return null;
}

function getLLMMessage(distance) {
    if (distance < 10) {
        return '매우 위험합니다! 바이러스에 감염될 확률이 매우 높습니다. 항상 2미터 이상의 거리를 유지하세요.';
    } else if (distance < 20) {
        return '위험합니다! 사회적 거리두기를 지키지 않았습니다. 다음번에는 2미터 이상 거리를 유지해주세요.';
    } else {
        return '안전한 거리를 유지하고 있습니다. 계속해서 사회적 거리두기를 실천해주세요.';
    }
}

let gameOver = false;

function gameLoop() {
    if (gameOver) {
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawPlayer();
    drawPeople();
    movePeople();

    const collisionDistance = checkCollision();
    if (collisionDistance !== null) {
        gameOver = true;
        const message = getLLMMessage(collisionDistance);
        messageDiv.innerHTML = `<h2>게임 종료</h2><p>${message}</p>`;
    }

    requestAnimationFrame(gameLoop);
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && player.x > 0) {
        player.x -= player.speed;
    } else if (e.key === 'ArrowRight' && player.x < canvas.width - player.width) {
        player.x += player.speed;
    }
});

gameLoop();