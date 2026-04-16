const socket = io({
    transports: ['websocket'],
    reconnection: true,             // try to reconnect after error
    reconnectionAttempts: Infinity, // always keep trying
    reconnectionDelay: 1000,        // try again after one second
    reconnectionDelayMax: 5000,     // don't wait more than 5 seconds between reconnects
    timeout: 20000                  // 20 seconds before announcing timeout
}); // connect to flask server
const touchpad = document.getElementById('touchpad');
const touchpadText = touchpad.querySelector('span');
const buttonsArea = document.getElementById('buttons-area');
const loadingScreen = document.getElementById('loading-screen');
const leftClick = document.getElementById('leftClick');
const rightClick = document.getElementById('rightClick');
const keyboardInput = document.getElementById('keyboard-input');
const keyboardContainer = document.getElementById('keyboard-area');
const DEADZONE = 1.0;         // minimum pixels required to move (make it more stable)
const THROTTLE_MS = 15;       // minimum time (in ms) between messages to prevent server lag
let islocked = false; // true when left click is pressed
let isLongPress = false; //determine whether long press or just a click
let pressTimeout; // 1s of pressing the left click to lock
let isCommandMode = false; // enter commands (e.g. alt+f4) after \
const ignoredKeys = [
    'Shift', 'CapsLock', 'Control', 'Alt', 'Meta', 
    'Dead', 'Clear', 'Unidentified', 'Process', 'AltGraph'
]; // commands to ignore when pressed on phone

let lastX = 0;
let lastY = 0;
let lastSendTime = 0;
let lastScrollY = 0;

function remoteLog(message) {
    // print to the browser
    console.log(message); 
    
    // send the log to the python to print in terminal
    if (socket.connected) {
        socket.emit('client_log', { msg: message });
    }
}

function type(message) {
    socket.emit('keyboard_action', { action: 'type', key: message });
    remoteLog(`Typed: '${message}'`);
    keyboardInput.value = '';
}

// diconnect automatically on refresh, close etc.
window.addEventListener('pagehide', () => {
    if (socket.connected) {
        remoteLog("Disconnected gracefully before refresh");
        socket.disconnect();
    }
});

socket.on('disconnect', () => {
    touchpad.style.display = 'none';
    buttonsArea.style.display = 'none';
    keyboardContainer.style.display = 'none';
    
    loadingScreen.innerHTML = "<h2>connection lost, reconnecting... 🔌</h2>";
    loadingScreen.style.display = 'flex';
});

socket.on('connect_error', (error) => {
    // show the error
    loadingScreen.innerHTML = `<h2 style="color: red;">connection error 🚫<br><small>${error.message}</small><br>reconnecting...</h2>`;
});

socket.on('connect', () => {
    loadingScreen.style.display = 'none';
    touchpad.style.display = 'flex';
    buttonsArea.style.display = 'flex';
    keyboardContainer.style.display = 'flex';
});

touchpad.addEventListener('touchstart', (e) => {
    touchpadText.classList.add('fade-out'); // remove text while touching the touch pad

    // save coordinates for relative movement
    if (e.touches.length == 1) {
    lastX = e.touches[0].clientX;
    lastY = e.touches[0].clientY;
    } else if (e.touches.length == 2) {
        lastScrollY = e.touches[0].clientY;
    }
});

touchpad.addEventListener('touchmove', (e) => {
    if (e.touches.length == 1) { // move cursor
        let currentX = e.touches[0].clientX;
        let currentY = e.touches[0].clientY;

        // calculate new delta
        let dx = currentX - lastX;
        let dy = currentY - lastY;

        // deadzone (ignore tiny shakes)
        if (Math.abs(dx) <= DEADZONE) dx = 0;
        if (Math.abs(dy) <= DEADZONE) dy = 0;

        // only send data if enough time passed and if there really is change
        const now = Date.now();
        if (now - lastSendTime > THROTTLE_MS && (dx !== 0 || dy !== 0)) {
            socket.emit('mouse_move', { x: dx, y: dy });
            lastSendTime = now;
        }

        // update last coordinates
        lastX = currentX;
        lastY = currentY;
    } else if (e.touches.length == 2) {
        const currentY = e.touches[0].clientY;
        const deltaY = currentY - lastScrollY;

        socket.emit('mouse_action', {action: 'scroll', dy: deltaY});
        lastScrollY = currentY;
    }
});

touchpad.addEventListener('touchend', (e) => {
    if (e.touches.length == 0)
        touchpadText.classList.remove('fade-out');
    else if (e.touches.length == 1) {
        // scroll ended but 1 finger left on touchpad, avoid mouse jump
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
    }
});

rightClick.addEventListener('click', () => {
    socket.emit('mouse_action', { button: 'right', action: 'click' });
});

leftClick.addEventListener('touchstart', () => {
    isLongPress = false;
    pressTimeout = setTimeout(() => { // if not canceled within 0.4 seconds press left button
        if (!islocked) {
            remoteLog("long press");
            socket.emit('mouse_action', { button: 'left', action: 'press' });
            leftClick.classList.add('is-locked');
            islocked = true;
        }
        isLongPress = true;
    }, 400);
});

leftClick.addEventListener('touchend', () => {
    clearTimeout(pressTimeout);

    if (islocked && !isLongPress) { // already locked, release left button
        socket.emit('mouse_action', { button: 'left', action: 'release' });
        islocked = false;
        leftClick.classList.remove('is-locked');
    } 
    else if (!islocked) { // decide whether to press or click
        if (!isLongPress) { // click left button
            socket.emit('mouse_action', { button: 'left', action: 'click' });
        }
        // else (press) already handled in the touchstart event
    }
});

keyboardInput.addEventListener('input', (e) => {
    const currentText = keyboardInput.value;
    isCommandMode = false;
    if (currentText.startsWith('\\') && !currentText.startsWith('\\\\')) { // \ is for commands and \\ is for writing \
        isCommandMode = true;    
    }
    if (e.data && !isCommandMode) {
        type(e.data);
    }
});

keyboardInput.addEventListener('keydown', (e) => {
    // block several keys with no fuction
    if (ignoredKeys.includes(e.key)){
        return;
    }
    // block double logs for single chars from input and keydown
    if (e.key.length == 1) {
        return;
    }
    // block emojis and hebrew vowels
    if (/\p{Emoji}/u.test(e.key) || /[\u0591-\u05C7]/.test(e.key)) {
        return;
    }
    if (e.key === 'Enter') {
        if (isCommandMode) {
            // cut \ from the start
            let keyboardText = keyboardInput.value.substring(1).toLowerCase();
            if (!keyboardText.startsWith(' ')) {
                keyboardInput.value = '';
                socket.emit('keyboard_action', { action: 'command', key: keyboardText });
                remoteLog(`Executed Command: ${keyboardText}`);
                keyboardInput.value = '';
            } else {
                keyboardText = keyboardText.substring(1);
                type(keyboardText);
            }
        } else if (!isCommandMode) {
            socket.emit('keyboard_action', { action: 'command', key: 'Enter' });
            remoteLog(`Pressed: Enter`);
        }
        isCommandMode = false;
    } else if (e.key && !isCommandMode) {
        socket.emit('keyboard_action', { action: 'command', key: e.key });
        remoteLog(`Pressed: ${e.key}`);
    }
});

keyboardInput.addEventListener('blur', () => {
    // מכריח את האייפון לגלול בחזרה למעלה ולאפס את המסך
    window.scrollTo(0, 0);
});