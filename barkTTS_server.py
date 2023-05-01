import datetime
from bark import SAMPLE_RATE, generate_audio, preload_models
from scipy.io.wavfile import write as write_wav
import numpy as np
import nltk
from http.server import HTTPServer, BaseHTTPRequestHandler

# nltk.download('punkt')
preload_models()

# Set up sample rate (importing instead atm)
# SAMPLE_RATE = 22050

# Set a History Prompt (buggy)
HISTORY_PROMPT = "en_speaker_3"

class RequestHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        # Add these lines to allow cross-origin requests
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Allow-Headers')
        self.end_headers()

        # Get the user input from the request body
        content_length = int(self.headers['Content-Length'])
        user_input = self.rfile.read(content_length).decode('utf-8')

        long_string = user_input

        # Tokenize to split strink into chunks for processing
        sentences = nltk.sent_tokenize(long_string)

        chunks = ['']
        token_counter = 0

        for sentence in sentences:
            current_tokens = len(nltk.Text(sentence))
            if token_counter + current_tokens <= 250:
                token_counter = token_counter + current_tokens
                chunks[-1] = chunks[-1] + " " + sentence
            else:
                chunks.append(sentence)
                token_counter = current_tokens

        # Generate audio for each prompt
        audio_arrays = []
        for prompt in chunks:
            audio_array = generate_audio(prompt,history_prompt=HISTORY_PROMPT)
            # audio_array = generate_audio(prompt)
            audio_arrays.append(audio_array)

        # Combine the audio files
        combined_audio = np.concatenate(audio_arrays)

        # Write the combined audio to a file
        # timestamp_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        # filename = f"Bark_audio_{timestamp_str}.wav"
        filename = './audio/bark_audio.wav'
        write_wav(filename, SAMPLE_RATE, combined_audio)

        # play audio using playsound
        # playsound.playsound(filename)

        # Send a response back to the client
        self.send_response(200)
        # self.send_header('Content-type', 'text/plain')
        self.send_header('Content-type', 'audio/wav')
        self.end_headers()
        # self.wfile.write(b'String sent to Bark\n')
        with open(filename, 'rb') as f:
            self.wfile.write(f.read())

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'X-Requested-With')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

def do_GET(self):
    # Check the path of the request
    if self.path == '/':
        # Return the index.html page
        self.send_response(200)
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        with open('index.html', 'rb') as f:
            self.wfile.write(f.read())
    elif self.path == '/audio/bark_audio.wav':
        # Return the audio file
        self.send_response(200)
        self.send_header('Content-type', 'audio/wav')
        self.end_headers()
        with open('./audio/bark_audio.wav', 'rb') as f:
            self.wfile.write(f.read())
        # Return the audio blob
        #audio_blob = get_audio_blob()  # function to get the audio blob
        #self.send_response(206)
        #self.send_header('Content-type', 'audio/wav')
        #self.send_header('Content-Range', 'bytes 0-{0}/{0}'.format(len(audio_blob)-1))
        #self.send_header('Content-Length', str(len(audio_blob)))
        #self.end_headers()
        #self.wfile.write(audio_blob)
    else:
        # Return a 404 error
        self.send_error(404, 'File Not Found')


def do_DELETE(self):
    # Set CORS headers
    self.send_response(200)
    self.send_header('Access-Control-Allow-Origin', '*')
    # self.send_header('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS')
    self.send_header('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Allow-Headers')
    self.end_headers()

    # Get the path of the requested file
    file_path = '.' + self.path

    # Check if the file exists
    if os.path.exists(file_path):
        os.remove(file_path)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'File deleted')
    else:
        self.send_response(404)
        self.end_headers()
        self.wfile.write(b'File not found')


# Start the HTTP server
httpd = HTTPServer(('localhost', 8080), RequestHandler)
httpd.serve_forever()
