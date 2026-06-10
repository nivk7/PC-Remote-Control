from pynput.mouse import Button, Controller as MouseController
from pynput.keyboard import KeyCode, Key, Controller as KeyboardController
from flask import Flask, render_template
from flask_socketio import emit, SocketIO
import logging

# write logs directly to terminal
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(levelname)s - %(message)s'
)

macros = {
    # window management
    "alt+f4": [Key.alt, Key.f4],
    "cmd+tab": [Key.cmd, Key.tab],
    "desktop": [Key.cmd, KeyCode(char='d')],
    "cmd": [Key.cmd],
    
    # media volume
    "volume_up": [Key.media_volume_up],
    "volume_down": [Key.media_volume_down],
    "mute": [Key.media_volume_mute],
    
    # basic actions
    "ctrl+c": [Key.ctrl, KeyCode(char='c')],
    "ctrl+v": [Key.ctrl, KeyCode(char='v')],
    "Enter": [Key.enter],
    "Escape": [Key.esc],
    "Backspace": [Key.backspace]
}

mouse = MouseController()
keyboard = KeyboardController()

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

@socketio.on('mouse_move')
def handle_mouse_move(data):
    dx = 1.5 * data['x']
    dy = 1.5 * data['y']
    mouse.move(dx, dy)

@socketio.on('mouse_action')
def handle_mouse_action(data):
    action = data.get('action') # 'press', 'release', 'click' or 'scroll'
    
    if action == 'scroll':
        dy = data.get('dy', 0)

        scroll_speed = dy * 0.03
        mouse.scroll(0, scroll_speed)
    else: 
        btn_type = data.get('button') # 'left' or 'right'

        if btn_type == 'right':
            mouse.click(Button.right)
        elif btn_type == 'left':
            if action == 'click':
                mouse.click(Button.left)
            elif action == 'press':
                mouse.press(Button.left)
            elif action == 'release':
                mouse.release(Button.left)

@socketio.on('keyboard_action')
def handle_keyboard_action(data):
    action = data.get('action') # 'type' or 'command'
    key = data.get('key')

    if action == 'type':
        keyboard.type(key)
    elif action == 'command':
        keys_to_press = macros.get(key)

        if keys_to_press:
            logging.info(f"Executing command: {key}")
            for pressKey in keys_to_press:
                keyboard.press(pressKey)
            for pressKey in reversed(keys_to_press):
                keyboard.release(pressKey)
        else:
           logging.warning(f"Command '{key}' not found") 

# print logs from JS to terminal
@socketio.on('client_log')
def handle_client_log(data):
    message = data.get('msg', 'No message')
    logging.info(f"[IPHONE JS] - {message}")

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
