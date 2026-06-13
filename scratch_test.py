import sys
import os
sys.path.append(os.path.abspath('s:/_Vibe_Coding/VocabCurve/backend'))
from image_search import search_bing_images

result = search_bing_images("perro")
print(f"Error: {result['error']}")
print(f"Number of images: {len(result['images'])}")
if result['error'] is not None:
    print(f"Error detail: {result['error']}")
for img in result['images'][:3]:
    print(img)
